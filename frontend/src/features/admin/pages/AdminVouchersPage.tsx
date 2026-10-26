/**
 * AdminVouchersPage (S-ADMIN1 Ph3b) — free transfers granted to accounts.
 *
 * Grant N free transfers to an account by email; the account uses them
 * automatically when it pays a transfer fee. Revoke cancels a grant's unused
 * ones. Filtering by email is an exact match, kept out of the URL, and the
 * server records each lookup in the audit log. Admin and super_admin only.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminApi } from '../api/adminApi';
import type { AdminVoucherGrant, AdminVoucherList } from '../api/pricingSchemas';
import { AdminGrantVouchersDialog, AdminRevokeVouchersDialog, type GrantedVouchers } from '../components/AdminVoucherDialogs';
import { AdminTable, Wrap, type AdminColumn } from '../components/AdminTable';
import { AdminPagination, AdminSearchBox, ListState } from '../components/AdminListParts';
import { fmtDate, fmtDateTime } from '../lib/pricing';
import { errorMessage, loadFailed } from '../lib/display';

const PAGE_SIZE = 25;

const STATUS_COPY: Record<AdminVoucherGrant['status'], { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
  used_up: { label: 'Used up', className: 'bg-dark-700 text-gray-300 border-white/10' },
  expired: { label: 'Expired', className: 'bg-dark-700 text-gray-400 border-white/10' },
  revoked: { label: 'Revoked', className: 'bg-red-500/10 text-red-300 border-red-500/30' },
};

type OpenDialog = { kind: 'none' } | { kind: 'grant' } | { kind: 'revoke'; grant: AdminVoucherGrant };

export const AdminVouchersPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  // The email filter is page state, not a URL parameter: the address bar would
  // keep the email in browser history.
  const [email, setEmail] = useState('');
  const rawPage = Number(searchParams.get('page') ?? '1');
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;

  const [reloadKey, setReloadKey] = useState(0);
  const queryKey = `${email}|${page}|${reloadKey}`;
  const [result, setResult] = useState<{ key: string; data: AdminVoucherList } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>({ kind: 'none' });

  useEffect(() => {
    let cancelled = false;
    adminApi
      .listVoucherGrants({ email: email || undefined, page, limit: PAGE_SIZE })
      .then((data) => {
        if (!cancelled) setResult({ key: queryKey, data });
      })
      .catch((err) => {
        if (!cancelled) setFailure({ key: queryKey, message: errorMessage(err, loadFailed('Free transfers')) });
      });
    return () => { cancelled = true; };
  }, [email, page, queryKey]);

  const error = failure?.key === queryKey ? failure.message : null;
  const loading = !error && result?.key !== queryKey;
  const data = result?.key === queryKey ? result.data : null;
  const grants = data?.grants ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  const goTo = (next: { email?: string; page?: number }) => {
    if (next.email !== undefined) setEmail(next.email);
    const p = next.page ?? 1;
    setSearchParams(p > 1 ? { page: String(p) } : {});
  };

  // An email-filtered list is an audited lookup: after a grant or revoke, update
  // the rows in place instead of looking the email up (and auditing) again.
  // The unfiltered list is not audited, so it simply reloads.
  const patchRows = (update: (grants: AdminVoucherGrant[]) => AdminVoucherGrant[], totalDelta = 0) =>
    setResult((prev) => (prev && prev.key === queryKey
      ? { key: prev.key, data: { ...prev.data, grants: update(prev.data.grants), total: prev.data.total + totalDelta } }
      : prev));

  const afterGrant = (granted: GrantedVouchers) => {
    setDialog({ kind: 'none' });
    if (!email) {
      setReloadKey((k) => k + 1);
      return;
    }
    // New grants are listed first, so only page 1 shows it; other pages stay as they are.
    if ((granted.userEmail ?? '').toLowerCase() !== email || page !== 1) return;
    const row: AdminVoucherGrant = {
      id: granted.id,
      userEmail: granted.userEmail,
      quantity: granted.quantity,
      remaining: granted.remaining,
      used: granted.quantity - granted.remaining,
      reason: granted.reason,
      expiresAt: granted.expiresAt,
      status: 'active',
      grantedBy: null,
      createdAt: new Date().toISOString(),
      revokedAt: null,
      revokedBy: null,
      revokeReason: null,
    };
    patchRows((grants) => [row, ...grants], 1);
  };

  const afterRevoke = (revoked: { id: string; revokedAt: string; reason: string }) => {
    setDialog({ kind: 'none' });
    if (!email) {
      setReloadKey((k) => k + 1);
      return;
    }
    patchRows((grants) => grants.map((g) => (g.id === revoked.id
      ? { ...g, status: 'revoked' as const, remaining: 0, revokedAt: revoked.revokedAt, revokeReason: revoked.reason }
      : g)));
  };

  const columns: ReadonlyArray<AdminColumn<AdminVoucherGrant>> = [
    { key: 'account', header: 'Account', width: 240, className: 'text-gray-200', cell: (g) => <Wrap text={g.userEmail ?? 'Deleted account'} /> },
    {
      key: 'left', header: 'Left', className: 'text-white',
      cell: (g) => (<>{g.remaining} of {g.quantity}<span className="block text-xs text-gray-400">{g.used} used</span></>),
    },
    { key: 'expires', header: 'Expires', className: 'text-gray-200', cell: (g) => (g.expiresAt ? fmtDate(g.expiresAt) : 'Never') },
    {
      key: 'status', header: 'Status',
      cell: (g) => <span className={`px-2 py-0.5 rounded-lg text-xs font-medium border ${STATUS_COPY[g.status].className}`}>{STATUS_COPY[g.status].label}</span>,
    },
    {
      key: 'reason', header: 'Reason', width: 260,
      cell: (g) => (
        <>
          {g.reason}
          {g.status === 'revoked' && (
            <span className="block text-xs text-gray-400 mt-1">
              Revoked {fmtDateTime(g.revokedAt)}{g.revokedBy ? ` by ${g.revokedBy}` : ''}
              {g.revokeReason ? `: ${g.revokeReason}` : ''}
            </span>
          )}
        </>
      ),
    },
    {
      key: 'granted', header: 'Granted',
      cell: (g) => (<>{fmtDateTime(g.createdAt)}{g.grantedBy && <span className="block text-xs text-gray-400">by {g.grantedBy}</span>}</>),
    },
    {
      key: 'actions', header: 'Actions', hideHeader: true, width: 200,
      cell: (g) => g.status === 'active' && (
        <button
          type="button"
          onClick={() => setDialog({ kind: 'revoke', grant: g })}
          aria-label={`Revoke free transfers for ${g.userEmail ?? 'this account'}`}
          className="px-3 py-1.5 rounded-xl text-xs font-medium bg-red-600/20 text-red-300 border border-red-500/30
            hover:bg-red-600/30 focus:outline-none focus:ring-2 focus:ring-primary-500
            focus:ring-offset-2 focus:ring-offset-dark-800"
        >
          Revoke free transfers…
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Free transfers</h1>
          <p className="text-gray-400 text-sm mt-1 max-w-2xl">
            Free transfers granted to an account. The account uses one automatically each time it pays a transfer fee,
            so it is not charged. Revoke cancels the ones not yet used.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDialog({ kind: 'grant' })}
          className="px-3 py-2 rounded-xl text-sm font-medium bg-primary-600 text-white hover:bg-primary-500
            focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
        >
          Grant free transfers…
        </button>
      </div>

      <AdminSearchBox
        label="Account email (exact)"
        placeholder="Account email (exact)"
        type="email"
        active={email}
        note="Each email lookup is recorded in the audit log."
        onSearch={(term) => goTo({ email: term.toLowerCase(), page: 1 })}
      />

      <ListState
        loading={loading}
        error={error}
        empty={grants.length === 0}
        emptyText={email ? `No free transfers have been granted to ${email}.` : 'No free transfers have been granted yet.'}
        what="free transfers"
      >
        <div className="space-y-4">
          <AdminTable id="free-transfers" label="Free transfers granted" columns={columns} rows={grants} rowKey={(g) => g.id} />
          <AdminPagination page={page} pages={pages} onPage={(p) => goTo({ page: p })} />
        </div>
      </ListState>

      {dialog.kind === 'grant' && (
        <AdminGrantVouchersDialog open onClose={() => setDialog({ kind: 'none' })} onDone={afterGrant} />
      )}
      {dialog.kind === 'revoke' && (
        <AdminRevokeVouchersDialog open grant={dialog.grant} onClose={() => setDialog({ kind: 'none' })} onDone={afterRevoke} />
      )}
    </div>
  );
};
