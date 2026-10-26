/**
 * AdminVerificationsPage (S22): list of Yoti ID checks that link creators'
 * accounts to their ID ("Creator ID checks" on screen).
 *
 * Mirrors the AdminAuctionsPage shape: URL-synced filters, status pills,
 * search on Enter (kept out of the URL), whole-row click into the detail
 * page where status changes happen.
 */

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AdminTable, Wrap, type AdminColumn } from '../components/AdminTable';
import { AdminPagination, AdminSearchBox, FilterPills, ListState } from '../components/AdminListParts';
import { adminApi } from '../api/adminApi';
import type {
  AdminYotiVerificationListRow,
  AdminYotiVerificationStatus,
} from '../api/adminApi';
import { errorMessage, formatWhen as fmt, loadFailed } from '../lib/display';
import { idCheckStatusLabel } from '../lib/labels';

const STATUS_OPTIONS: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'All', value: '' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Verified', value: 'VERIFIED,APPROVED' },
  { label: 'Rejected', value: 'REJECTED' },
  { label: 'Revoked', value: 'REVOKED' },
  { label: 'Flagged', value: 'FLAGGED' },
  { label: 'Not started', value: 'NONE' },
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
  <span title={status} className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusClass(status)}`}>
    {idCheckStatusLabel(status)}
  </span>
);

export const AdminVerificationsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const statusFilter = searchParams.get('status') ?? '';
  const page = Math.max(parseInt(searchParams.get('page') ?? '1', 10) || 1, 1);
  // Kept out of the URL: it is often an email.
  const [search, setSearch] = useState('');

  const queryKey = `${statusFilter}|${search}|${page}`;
  const [result, setResult] = useState<{ key: string; rows: AdminYotiVerificationListRow[]; total: number; pages: number } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .listYotiVerifications({ status: statusFilter || undefined, search: search || undefined, page, limit: 25 })
      .then((res) => {
        if (!cancelled) setResult({ key: queryKey, rows: res.data.results, total: res.data.total, pages: res.data.totalPages || 1 });
      })
      .catch((err) => {
        if (!cancelled) setFailure({ key: queryKey, message: errorMessage(err, loadFailed('Creator ID checks')) });
      });
    return () => { cancelled = true; };
  }, [statusFilter, search, page, queryKey]);

  const error = failure?.key === queryKey ? failure.message : null;
  const loading = !error && result?.key !== queryKey;
  const rows = result?.key === queryKey ? result.rows : [];
  const total = result?.total ?? 0;

  const setParams = (changes: Record<string, string>) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(changes)) {
        if (v) next.set(k, v); else next.delete(k);
      }
      return next;
    });
  };

  const columns: ReadonlyArray<AdminColumn<AdminYotiVerificationListRow>> = [
    {
      key: 'account', header: 'Account', width: 260,
      cell: (row) => (
        <>
          <Link
            to={`/admin/verifications/${row.user_id}`}
            className="text-white font-medium hover:text-primary-300 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {row.display_name || row.email}
          </Link>
          {row.display_name && <Wrap text={row.email} className="block text-xs text-gray-400" />}
        </>
      ),
    },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'age', header: 'Age verified',
      cell: (row) => (row.age_verified ? <span className="text-emerald-400">Yes</span> : <span className="text-gray-400">No</span>),
    },
    { key: 'submitted', header: 'Submitted', cell: (row) => fmt(row.submitted_at) },
    { key: 'updated', header: 'Last update', cell: (row) => fmt(row.yoti_last_event_at) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Creator ID checks</h1>
        <p className="text-gray-400 text-sm mt-1">
          {total} account{total === 1 ? '' : 's'} with ID check activity
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <FilterPills label="Filter by status" options={STATUS_OPTIONS} value={statusFilter} onChange={(v) => setParams({ status: v, page: '' })} />
        <AdminSearchBox
          label="Search creator ID checks"
          placeholder="Email or display name…"
          active={search}
          note="Search runs when you press Enter."
          onSearch={(term) => { setSearch(term); setParams({ page: '' }); }}
        />
      </div>

      <ListState loading={loading} error={error} empty={rows.length === 0} emptyText="No ID checks match. Try another status or search." what="creator ID checks">
        <div className="space-y-4">
          <AdminTable
            id="creator-id-checks"
            label="Creator ID checks"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.user_id}
            rowHref={(r) => `/admin/verifications/${r.user_id}`}
          />
          <AdminPagination page={page} pages={result?.pages ?? 1} onPage={(p) => setParams({ page: String(p) })} />
        </div>
      </ListState>
    </div>
  );
};
