/**
 * AdminTagsPage (S-ADMIN1) — token inventory.
 *
 * Status and page are URL-synced like the other admin lists. The search term is
 * NOT: it is often an email, and the address bar would keep it in browser
 * history. One box matches owner email (partial), chip name, serial suffix or
 * UID suffix; the backend audit-logs every search.
 * Each row's chip label is a real link, so the table is keyboard navigable.
 */

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi, chipLabel, type AdminTag, type AdminTagLifecycleStatus } from '../api/adminApi';
import { AdminLifecycleBadge } from '../components/AdminLifecycleBadge';

const STATUS_OPTIONS: ReadonlyArray<{ label: string; value: '' | AdminTagLifecycleStatus }> = [
  { label: 'All', value: '' },
  { label: 'Enrolled', value: 'ENROLLED' },
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Suspended', value: 'SUSPENDED' },
  { label: 'Retired', value: 'RETIRED' },
  { label: 'Released', value: 'RELEASED' },
];

const PAGE_SIZE = 25;
const fmt = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString() : '—');
const shortId = (id: string | null): string => (id ? `${id.slice(0, 8)}…` : '—');

export const AdminTagsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = (searchParams.get('status') ?? '') as '' | AdminTagLifecycleStatus;
  const page = Math.max(parseInt(searchParams.get('page') ?? '1', 10) || 1, 1);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  // Results are keyed by the query that produced them, so "loading" is derived
  // (no synchronous setState inside the effect).
  const queryKey = `${status}|${search}|${page}`;
  const [result, setResult] = useState<{ key: string; rows: AdminTag[]; total: number; truncated: boolean } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .listTags({ status: status || undefined, q: search || undefined, page, limit: PAGE_SIZE })
      .then((res) => {
        if (!cancelled) {
          setResult({
            key: queryKey,
            rows: res.data.tags,
            total: res.data.pagination.total,
            truncated: res.data.emailMatchesTruncated ?? false,
          });
        }
      })
      .catch((err) => {
        if (!cancelled) setFailure({ key: queryKey, message: err instanceof Error ? err.message : 'Failed to load tags' });
      });
    return () => { cancelled = true; };
  }, [status, search, page, queryKey]);

  const error = failure?.key === queryKey ? failure.message : null;
  const loading = !error && result?.key !== queryKey;
  const rows = result?.key === queryKey ? result.rows : [];
  const total = result?.total ?? 0;
  const truncated = result?.key === queryKey && result.truncated;

  const update = (changes: Record<string, string>) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(changes)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      if (!('page' in changes)) next.set('page', '1');
      return next;
    });
  };

  // Mirrors the backend's searchTermSchema.
  const searchValid = searchInput === '' || /^[A-Za-z0-9@._+'-]{2,254}$/.test(searchInput);
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Tags</h1>
        <p className="text-gray-400 text-sm mt-1">{total} chip{total === 1 ? '' : 's'}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2 flex-wrap" role="group" aria-label="Filter by status">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value || 'all'}
              type="button"
              aria-pressed={status === opt.value}
              onClick={() => update({ status: opt.value })}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors
                focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800
                ${status === opt.value
                  ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30'
                  : 'bg-dark-700 text-gray-400 hover:text-white hover:bg-dark-600'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <form
          className="ml-auto flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!searchValid) return;
            setSearch(searchInput);
            if (page !== 1) update({ page: '1' });
          }}
        >
          <label htmlFor="tag-search" className="sr-only">Search by owner email, chip name, serial or UID</label>
          <input
            id="tag-search"
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value.trim())}
            placeholder="Email, chip name, serial or UID…"
            aria-invalid={!searchValid}
            aria-describedby="tag-search-note"
            autoComplete="off"
            className="px-3 py-2 rounded-xl bg-dark-700 text-white placeholder:text-gray-400
              border border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800
              min-w-[16rem]"
          />
          <button
            type="submit"
            disabled={!searchValid}
            className="px-3 py-2 rounded-xl text-sm bg-dark-700 text-gray-200 hover:bg-dark-600 disabled:opacity-50
              focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
          >
            Search
          </button>
        </form>
      </div>
      <p id="tag-search-note" className="text-xs text-gray-400 -mt-3 text-right">Searches are recorded in the audit log.</p>
      {truncated && (
        <p role="status" className="text-amber-300 text-sm">
          More than 50 accounts match that email. Only the first 50 are shown; type more of the address.
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48" role="status" aria-label="Loading tags">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="glass rounded-2xl p-6 border border-red-500/30">
          <p role="alert" className="text-red-400 text-sm">{error}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="glass rounded-2xl p-6">
          <p className="text-gray-400 text-sm">No chips match the current filters.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-dark-700 text-gray-400">
              <tr>
                <th scope="col" className="text-left px-4 py-3 font-medium">Chip</th>
                <th scope="col" className="text-left px-4 py-3 font-medium">Status</th>
                <th scope="col" className="text-left px-4 py-3 font-medium">Owner</th>
                <th scope="col" className="text-left px-4 py-3 font-medium">Creator</th>
                <th scope="col" className="text-left px-4 py-3 font-medium">Key ver.</th>
                <th scope="col" className="text-left px-4 py-3 font-medium">Taps</th>
                <th scope="col" className="text-left px-4 py-3 font-medium">Enrolled</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-white/5 hover:bg-white/[0.04]">
                  <td className="px-4 py-3">
                    <Link
                      to={`/admin/tags/${row.id}`}
                      className="font-mono text-primary-300 hover:underline rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      {chipLabel(row)}
                    </Link>
                  </td>
                  <td className="px-4 py-3"><AdminLifecycleBadge status={row.lifecycleStatus} /></td>
                  <td className="px-4 py-3 text-gray-300 break-all">{row.ownerEmail ?? shortId(row.ownerAccountId)}</td>
                  <td className="px-4 py-3 text-gray-300 break-all">{row.creatorEmail ?? shortId(row.creatorAccountId)}</td>
                  <td className="px-4 py-3 text-gray-300">{row.sdmKeyVersion ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-300">{row.sunCounter}</td>
                  <td className="px-4 py-3 text-gray-400">{fmt(row.registeredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <nav className="flex items-center justify-between text-sm text-gray-400" aria-label="Pagination">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => update({ page: String(page - 1) })}
            className="px-3 py-1.5 rounded-xl bg-dark-700 hover:bg-dark-600 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            Previous
          </button>
          <span>Page {page} of {totalPages}</span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => update({ page: String(page + 1) })}
            className="px-3 py-1.5 rounded-xl bg-dark-700 hover:bg-dark-600 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
};
