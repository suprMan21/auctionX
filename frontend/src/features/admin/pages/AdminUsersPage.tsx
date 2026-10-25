/**
 * Admin accounts list (S-ADMIN2 Ph1).
 * Search by email, display name or account id; filter by status or staff.
 * A non-empty search is audit-logged by the server before it runs.
 * @module Module 10 — Admin Dashboard
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi } from '../api/adminApi';
import { ROLE_LABELS, type AccountSearch, type AccountStatus } from '../api/accountSchemas';
import { hasPermission, PERMISSIONS, useAdminRole } from '../lib/adminRole';
import { DeleteWindowCard } from '../components/DeleteWindowCard';

const STATUS_FILTERS = [
  { value: 'all', label: 'All accounts' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'retired', label: 'Retired' },
  { value: 'staff', label: 'Staff' },
] as const;

const STATUS_STYLE: Record<AccountStatus, string> = {
  active: 'bg-success-500/10 text-success-500',
  suspended: 'bg-warning-500/10 text-warning-500',
  retired: 'bg-white/5 text-gray-400',
};

export const AccountStatusBadge = ({ status }: { status: AccountStatus }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[status]}`}>
    {status[0].toUpperCase() + status.slice(1)}
  </span>
);

const Pagination = ({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) => {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center gap-2 justify-center pt-4">
      <button
        type="button"
        onClick={() => onPage(page - 1)}
        disabled={page === 1}
        className="min-h-[44px] px-3 rounded-xl text-sm text-gray-300 hover:text-white hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        ← Prev
      </button>
      <span className="text-sm text-gray-400">Page {page} of {pages}</span>
      <button
        type="button"
        onClick={() => onPage(page + 1)}
        disabled={page === pages}
        className="min-h-[44px] px-3 rounded-xl text-sm text-gray-300 hover:text-white hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        Next →
      </button>
    </div>
  );
};

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');

export const AdminUsersPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const access = useAdminRole();
  const [loaded, setLoaded] = useState<{ key: string; data: AccountSearch | null; error: string | null } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const q = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? 'all';
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);

  const queryKey = `${q}|${status}|${page}`;
  useEffect(() => {
    let cancelled = false;
    adminApi
      .searchAccounts({ q: q || undefined, status, page, limit: 25 })
      .then((data) => { if (!cancelled) setLoaded({ key: queryKey, data, error: null }); })
      .catch((err: unknown) => {
        if (!cancelled) setLoaded({ key: queryKey, data: null, error: err instanceof Error ? err.message : 'Accounts could not be loaded' });
      });
    return () => { cancelled = true; };
  }, [q, status, page, queryKey]);
  const loading = loaded?.key !== queryKey;
  const result = loading ? null : loaded?.data ?? null;
  const error = loading ? null : loaded?.error ?? null;

  const update = (changes: Record<string, string | null>) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(changes)) {
        if (v) next.set(k, v); else next.delete(k);
      }
      return next;
    });

  const onSearch = (value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // A longer pause than a typeahead: every search writes an audit row.
    debounceRef.current = setTimeout(() => update({ q: value.trim() || null, page: '1' }), 500);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Users</h1>
        <p className="text-gray-400 text-sm mt-1">
          {result ? `${result.pagination.total.toLocaleString()} matching accounts. ` : ''}
          Searches are recorded in the audit log.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <label className="flex-1">
          <span className="sr-only">Search accounts</span>
          <input
            data-testid="user-search"
            type="search"
            defaultValue={q}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Email, display name or account id…"
            className="w-full min-h-[44px] px-4 py-2 rounded-xl bg-dark-700 text-white placeholder:text-gray-400 border border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </label>
        <label>
          <span className="sr-only">Filter by status</span>
          <select
            value={status}
            onChange={(e) => update({ status: e.target.value === 'all' ? null : e.target.value, page: '1' })}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-dark-700 text-white border border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {STATUS_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </label>
      </div>

      <div data-testid="users-table" className="glass rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48" role="status" aria-label="Loading accounts">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <p className="p-6 text-error-500 text-sm" role="alert">{error}</p>
        ) : !result || result.accounts.length === 0 ? (
          <p className="p-6 text-gray-400 text-sm">No accounts found.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-dark-700 border-b border-white/10">
                  <tr>
                    {['Email', 'Display name', 'Role', 'Status', 'Last sign-in', 'Created'].map((h) => (
                      <th key={h} scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {result.accounts.map((a) => (
                    <tr key={a.id} className="bg-dark-800 hover:bg-dark-700 transition-colors">
                      <td className="px-4 py-3 text-sm max-w-[240px] truncate">
                        <Link to={`/admin/users/${a.id}`} className="text-white hover:text-primary-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded">
                          {a.email ?? a.id}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300">{a.display_name ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-300">{a.staff_role ? (ROLE_LABELS[a.staff_role] ?? a.staff_role) : '—'}</td>
                      <td className="px-4 py-3"><AccountStatusBadge status={a.status} /></td>
                      <td className="px-4 py-3 text-sm text-gray-400">{formatDate(a.last_sign_in_at)}</td>
                      <td className="px-4 py-3 text-sm text-gray-400">{formatDate(a.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t border-white/10">
              <Pagination page={result.pagination.page} pages={result.pagination.pages} onPage={(p) => update({ page: String(p) })} />
            </div>
          </>
        )}
      </div>

      <DeleteWindowCard canEdit={hasPermission(access, PERMISSIONS.manageAdmins)} />
    </div>
  );
};
