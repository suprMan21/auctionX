/**
 * Admin accounts list (S-ADMIN2 Ph1).
 * Search by email, display name or account id; filter by status or staff,
 * and by account type (Collector / Creator / Creator verifying).
 * A non-empty search is audit-logged by the server before it runs.
 * @module Module 10 — Admin Dashboard
 */

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi } from '../api/adminApi';
import { ROLE_LABELS, type AccountSearch, type AccountStatus } from '../api/accountSchemas';
import { NONE, errorMessage, formatDay, loadFailed } from '../lib/display';
import { AdminTable, type AdminColumn } from '../components/AdminTable';
import { AdminPagination, AdminSearchBox, FilterPills, ListState } from '../components/AdminListParts';
import { AccountTypeBadge } from '../components/AccountTypeBadge';

const STATUS_FILTERS = [
  { value: 'all', label: 'All accounts' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'retired', label: 'Retired' },
  { value: 'staff', label: 'Staff' },
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number]['value'];

const TYPE_FILTERS = [
  { value: 'all', label: 'All types' },
  { value: 'collector', label: 'Collectors' },
  { value: 'creator', label: 'Creators' },
  { value: 'creator_pending', label: 'Creator (verifying)' },
] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number]['value'];
type AccountRow = AccountSearch['accounts'][number];

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

export const AdminUsersPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [loaded, setLoaded] = useState<{ key: string; data: AccountSearch | null; error: string | null } | null>(null);
  // The search term stays out of the URL (it is often an email; the address
  // bar would keep it in browser history). Status and page are in the URL.
  const [q, setQ] = useState('');

  const rawStatus = searchParams.get('status') ?? 'all';
  // An unknown ?status= falls back to all rather than a 400 from the API.
  const status: StatusFilter = STATUS_FILTERS.some((f) => f.value === rawStatus) ? (rawStatus as StatusFilter) : 'all';
  const rawType = searchParams.get('type') ?? 'all';
  const type: TypeFilter = TYPE_FILTERS.some((f) => f.value === rawType) ? (rawType as TypeFilter) : 'all';
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);

  const queryKey = `${q}|${status}|${type}|${page}`;
  useEffect(() => {
    let cancelled = false;
    adminApi
      .searchAccounts({ q: q || undefined, status, type, page, limit: 25 })
      .then((data) => { if (!cancelled) setLoaded({ key: queryKey, data, error: null }); })
      .catch((err: unknown) => {
        if (!cancelled) setLoaded({ key: queryKey, data: null, error: errorMessage(err, loadFailed('Accounts')) });
      });
    return () => { cancelled = true; };
  }, [q, status, type, page, queryKey]);
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

  const columns: ReadonlyArray<AdminColumn<AccountRow>> = [
    {
      key: 'email', header: 'Email', width: 260, className: 'text-sm',
      cell: (a) => (
        <Link to={`/admin/users/${a.id}`} title={a.email ?? a.id} className="break-all text-white hover:text-primary-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded">
          {a.email ?? a.id}
        </Link>
      ),
    },
    { key: 'name', header: 'Display name', cell: (a) => a.display_name ?? NONE },
    { key: 'type', header: 'Type', cell: (a) => <AccountTypeBadge type={a.account_type} creatorPending={a.creator_pending} /> },
    { key: 'role', header: 'Staff role', cell: (a) => (a.staff_role ? (ROLE_LABELS[a.staff_role] ?? a.staff_role) : NONE) },
    { key: 'status', header: 'Status', cell: (a) => <AccountStatusBadge status={a.status} /> },
    { key: 'signin', header: 'Last sign-in', className: 'text-gray-400', cell: (a) => formatDay(a.last_sign_in_at) },
    { key: 'created', header: 'Created', className: 'text-gray-400', cell: (a) => formatDay(a.created_at) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Accounts</h1>
        <p className="text-gray-400 text-sm mt-1">
          {result ? `${result.pagination.total.toLocaleString()} matching accounts.` : '\u00a0'}
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <FilterPills
          label="Filter by status"
          options={STATUS_FILTERS}
          value={status}
          onChange={(v) => update({ status: v === 'all' ? null : v, page: null })}
        />
        <FilterPills
          label="Filter by account type"
          options={TYPE_FILTERS}
          value={type}
          onChange={(v) => update({ type: v === 'all' ? null : v, page: null })}
        />
        <AdminSearchBox
          label="Search accounts"
          placeholder="Email, display name or account ID…"
          active={q}
          onSearch={(term) => { setQ(term); update({ page: null }); }}
        />
      </div>

      <ListState
        loading={loading}
        error={error}
        empty={!result || result.accounts.length === 0}
        emptyText="No accounts match. Try another search or filter."
        what="accounts"
      >
        {result && (
          <div className="space-y-4">
            <AdminTable
              id="accounts"
              label="Accounts"
              testId="users-table"
              columns={columns}
              rows={result.accounts}
              rowKey={(a) => a.id}
              rowHref={(a) => `/admin/users/${a.id}`}
            />
            <AdminPagination page={result.pagination.page} pages={result.pagination.pages} onPage={(p) => update({ page: String(p) })} />
          </div>
        )}
      </ListState>

    </div>
  );
};
