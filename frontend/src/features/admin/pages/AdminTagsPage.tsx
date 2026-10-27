/**
 * AdminTagsPage (S-ADMIN1) — token inventory.
 *
 * Status and page are URL-synced like the other admin lists. The search term is
 * NOT: it is often an email, and the address bar would keep it in browser
 * history. One box matches owner email (partial), chip name, serial suffix or
 * UID suffix (the placeholder does not mention the UID); the backend
 * audit-logs every search.
 * Each row's chip label is a real link, so the table is keyboard navigable.
 */

import { useEffect, useState } from 'react';
import { AccountLink } from '../components/AccountLink';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi, type AdminTag, type AdminTagLifecycleStatus } from '../api/adminApi';
import { AdminLifecycleBadge } from '../components/AdminLifecycleBadge';
import { ChipName } from '../components/ChipName';
import { NONE, errorMessage, formatWhen as fmt, loadFailed } from '../lib/display';
import { AdminTable, type AdminColumn } from '../components/AdminTable';
import { AdminPagination, AdminSearchBox, FilterPills, ListState } from '../components/AdminListParts';

const STATUS_OPTIONS: ReadonlyArray<{ label: string; value: '' | AdminTagLifecycleStatus }> = [
  { label: 'All', value: '' },
  { label: 'Ready to claim', value: 'ENROLLED' },
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Suspended', value: 'SUSPENDED' },
  { label: 'Retired', value: 'RETIRED' },
  { label: 'Released by owner', value: 'RELEASED' },
];

const PAGE_SIZE = 25;

export const AdminTagsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = (searchParams.get('status') ?? '') as '' | AdminTagLifecycleStatus;
  const page = Math.max(parseInt(searchParams.get('page') ?? '1', 10) || 1, 1);

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
        if (!cancelled) setFailure({ key: queryKey, message: errorMessage(err, loadFailed('Tokens')) });
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

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  const columns: ReadonlyArray<AdminColumn<AdminTag>> = [
    {
      key: 'token', header: 'Token', width: 180,
      cell: (row) => (
        <Link
          to={`/admin/tags/${row.id}`}
          className="text-primary-300 hover:underline rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <ChipName tag={row} />
        </Link>
      ),
    },
    { key: 'status', header: 'Status', cell: (row) => <AdminLifecycleBadge status={row.lifecycleStatus} /> },
    { key: 'owner', header: 'Owner', width: 220, cell: (row) => <AccountLink id={row.ownerAccountId} email={row.ownerEmail} /> },
    { key: 'creator', header: 'Creator', width: 220, cell: (row) => <AccountLink id={row.creatorAccountId} email={row.creatorEmail} /> },
    { key: 'key', header: 'Key version', cell: (row) => row.sdmKeyVersion ?? NONE },
    { key: 'taps', header: 'Times tapped', cell: (row) => row.sunCounter },
    { key: 'setup', header: 'Set up', className: 'text-gray-400', cell: (row) => fmt(row.registeredAt) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Tokens</h1>
        <p className="text-gray-400 text-sm mt-1">{total} token{total === 1 ? '' : 's'}</p>
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <FilterPills label="Filter by status" options={STATUS_OPTIONS} value={status} onChange={(v) => update({ status: v })} />
        <AdminSearchBox
          label="Search by owner email, token name or serial number"
          placeholder="Owner email, token name or serial number…"
          active={search}
          // Mirrors the backend's searchTermSchema.
          validate={(t) => (/^[A-Za-z0-9@._+'-]{2,254}$/.test(t) ? null : 'Use 2 or more letters, numbers or @ . _ + \' -')}
          onSearch={(term) => {
            setSearch(term);
            if (page !== 1) update({ page: '1' });
          }}
        />
      </div>
      {truncated && (
        <p role="status" className="text-amber-300 text-sm">
          More than 50 accounts match that email. Showing the first 50. Type more of the address to narrow it down.
        </p>
      )}

      <ListState loading={loading} error={error} empty={rows.length === 0} emptyText="No tokens match. Try another status or search." what="tokens">
        <div className="space-y-4">
          <AdminTable id="tokens" label="Tokens" columns={columns} rows={rows} rowKey={(r) => r.id} rowHref={(r) => `/admin/tags/${r.id}`} />
          <AdminPagination page={page} pages={totalPages} onPage={(p) => update({ page: String(p) })} />
        </div>
      </ListState>
    </div>
  );
};
