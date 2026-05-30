/**
 * AdminVerificationsPage (S22) — list of Yoti-driven seller verifications.
 *
 * Mirrors the AdminAuctionsPage shape: URL-synced filters, status pills,
 * debounced search, row-click into a detail page where overrides happen.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { adminApi } from '../api/adminApi';
import type {
  AdminYotiVerificationListRow,
  AdminYotiVerificationStatus,
} from '../api/adminApi';

const STATUS_OPTIONS: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'All', value: '' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Verified', value: 'VERIFIED,APPROVED' },
  { label: 'Rejected', value: 'REJECTED' },
  { label: 'Revoked', value: 'REVOKED' },
  { label: 'Flagged', value: 'FLAGGED' },
  { label: 'None', value: 'NONE' },
];

const statusClass = (status: AdminYotiVerificationStatus): string => {
  switch (status) {
    case 'VERIFIED':
    case 'APPROVED':
      return 'bg-emerald-500/20 text-emerald-400';
    case 'PENDING':
      return 'bg-yellow-500/20 text-yellow-400';
    case 'REJECTED':
    case 'REVOKED':
      return 'bg-red-500/20 text-red-400';
    case 'FLAGGED':
      return 'bg-orange-500/20 text-orange-400';
    default:
      return 'bg-gray-500/20 text-gray-400';
  }
};

const StatusBadge = ({ status }: { status: AdminYotiVerificationStatus }) => (
  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusClass(status)}`}>
    {status}
  </span>
);

const fmt = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString() : '—');

export const AdminVerificationsPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const statusFilter = searchParams.get('status') ?? '';
  const initialSearch = searchParams.get('search') ?? '';
  const page = Math.max(parseInt(searchParams.get('page') ?? '1', 10) || 1, 1);

  const [searchInput, setSearchInput] = useState(initialSearch);
  const [rows, setRows] = useState<AdminYotiVerificationListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  // Debounced search-param sync (350ms).
  useEffect(() => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (searchInput) next.set('search', searchInput);
        else next.delete('search');
        next.set('page', '1');
        return next;
      });
    }, 350);
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    adminApi
      .listYotiVerifications({
        status: statusFilter || undefined,
        search: searchParams.get('search') ?? undefined,
        page,
        limit: 25,
      })
      .then((res) => {
        if (cancelled) return;
        setRows(res.data.results);
        setTotal(res.data.total);
        setTotalPages(res.data.totalPages || 1);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load verifications');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [statusFilter, searchParams, page]);

  const setStatus = (value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set('status', value);
      else next.delete('status');
      next.set('page', '1');
      return next;
    });
  };

  const setPage = (p: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', String(p));
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Verifications</h1>
        <p className="text-gray-400 text-sm mt-1">
          {total} user{total === 1 ? '' : 's'} with Yoti verification activity
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2 flex-wrap">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value || 'all'}
              onClick={() => setStatus(opt.value)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors
                focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800
                ${statusFilter === opt.value
                  ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30'
                  : 'bg-dark-700 text-gray-400 hover:text-white hover:bg-dark-600'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search email or display name"
          aria-label="Search verifications"
          className="ml-auto px-3 py-2 rounded-xl bg-dark-700 text-white placeholder:text-gray-500
            border border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800
            min-w-[14rem]"
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="glass rounded-2xl p-6 border border-red-500/30">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="glass rounded-2xl p-6">
          <p className="text-gray-400 text-sm">No verifications match the current filters.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-dark-700 text-gray-400">
              <tr>
                <th className="text-left px-4 py-3 font-medium">User</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Age Verified</th>
                <th className="text-left px-4 py-3 font-medium">Submitted</th>
                <th className="text-left px-4 py-3 font-medium">Last Event</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.user_id}
                  onClick={() => navigate(`/admin/verifications/${row.user_id}`)}
                  className="border-t border-white/5 cursor-pointer hover:bg-white/[0.04] focus-within:bg-white/[0.04]"
                >
                  <td className="px-4 py-3">
                    <div className="text-white font-medium">{row.display_name || row.email}</div>
                    <div className="text-xs text-gray-500">{row.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    {row.age_verified ? (
                      <span className="text-emerald-400">Yes</span>
                    ) : (
                      <span className="text-gray-500">No</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-300">{fmt(row.submitted_at)}</td>
                  <td className="px-4 py-3 text-gray-300">{fmt(row.yoti_last_event_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="px-3 py-1.5 rounded-xl bg-dark-700 text-gray-300 hover:bg-dark-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Prev
          </button>
          <span className="text-sm text-gray-400">
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
            className="px-3 py-1.5 rounded-xl bg-dark-700 text-gray-300 hover:bg-dark-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};
