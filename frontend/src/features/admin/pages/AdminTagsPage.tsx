/**
 * AdminTagsPage (S-ADMIN1) — token inventory.
 *
 * URL-synced filters (status, UID suffix, page) like the other admin lists.
 * Each row's chip suffix is a real link, so the table is keyboard navigable.
 */

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi, type AdminTag, type AdminTagLifecycleStatus } from '../api/adminApi';
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
  const uidSuffix = searchParams.get('uid') ?? '';
  const page = Math.max(parseInt(searchParams.get('page') ?? '1', 10) || 1, 1);

  const [suffixInput, setSuffixInput] = useState(uidSuffix);
  // Results are keyed by the query that produced them, so "loading" is derived
  // (no synchronous setState inside the effect).
  const queryKey = `${status}|${uidSuffix}|${page}`;
  const [result, setResult] = useState<{ key: string; rows: AdminTag[]; total: number } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .listTags({ status: status || undefined, uidSuffix: uidSuffix || undefined, page, limit: PAGE_SIZE })
      .then((res) => {
        if (!cancelled) setResult({ key: queryKey, rows: res.data.tags, total: res.data.pagination.total });
      })
      .catch((err) => {
        if (!cancelled) setFailure({ key: queryKey, message: err instanceof Error ? err.message : 'Failed to load tags' });
      });
    return () => { cancelled = true; };
  }, [status, uidSuffix, page, queryKey]);

  const error = failure?.key === queryKey ? failure.message : null;
  const loading = !error && result?.key !== queryKey;
  const rows = result?.key === queryKey ? result.rows : [];
  const total = result?.total ?? 0;

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

  const suffixValid = suffixInput === '' || /^[0-9a-fA-F]{2,14}$/.test(suffixInput);
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
            if (suffixValid) update({ uid: suffixInput.toUpperCase() });
          }}
        >
          <label htmlFor="uid-suffix" className="sr-only">UID suffix</label>
          <input
            id="uid-suffix"
            value={suffixInput}
            onChange={(e) => setSuffixInput(e.target.value.trim())}
            placeholder="UID ends with…"
            aria-invalid={!suffixValid}
            className="px-3 py-2 rounded-xl bg-dark-700 text-white placeholder:text-gray-500 font-mono
              border border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800
              min-w-[12rem]"
          />
          <button
            type="submit"
            disabled={!suffixValid}
            className="px-3 py-2 rounded-xl text-sm bg-dark-700 text-gray-200 hover:bg-dark-600 disabled:opacity-50
              focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
          >
            Search
          </button>
        </form>
      </div>

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
                <th scope="col" className="text-left px-4 py-3 font-medium">Owner account</th>
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
                      …{row.uidSuffix}
                    </Link>
                  </td>
                  <td className="px-4 py-3"><AdminLifecycleBadge status={row.lifecycleStatus} /></td>
                  <td className="px-4 py-3 font-mono text-gray-300">{shortId(row.ownerAccountId)}</td>
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
