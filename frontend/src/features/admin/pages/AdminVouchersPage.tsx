/**
 * AdminVouchersPage (S-ADMIN1 Ph3b) — free transfers granted to accounts.
 *
 * Grant N free transfers to an account by email; the account uses them
 * automatically when it pays a transfer fee. Revoke cancels a grant's unused
 * ones. Filtering by email is an exact match and the server records each
 * lookup in the audit log. Admin and super_admin only.
 */

import { useEffect, useId, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminApi } from '../api/adminApi';
import type { AdminVoucherGrant, AdminVoucherList } from '../api/pricingSchemas';
import { AdminGrantVouchersDialog, AdminRevokeVouchersDialog } from '../components/AdminVoucherDialogs';
import { ADMIN_FIELD_CLASS } from '../components/AdminDialog';
import { fmtDate, fmtDateTime } from '../lib/pricing';

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
  const email = (searchParams.get('email') ?? '').trim().toLowerCase();
  const rawPage = Number(searchParams.get('page') ?? '1');
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;

  const [draft, setDraft] = useState(email);
  const [reloadKey, setReloadKey] = useState(0);
  const queryKey = `${email}|${page}|${reloadKey}`;
  const [result, setResult] = useState<{ key: string; data: AdminVoucherList } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>({ kind: 'none' });
  const filterId = useId();
  const filterHintId = useId();

  useEffect(() => {
    let cancelled = false;
    adminApi
      .listVoucherGrants({ email: email || undefined, page, limit: PAGE_SIZE })
      .then((data) => {
        if (!cancelled) setResult({ key: queryKey, data });
      })
      .catch((err) => {
        if (!cancelled) setFailure({ key: queryKey, message: err instanceof Error ? err.message : 'Failed to load free transfers' });
      });
    return () => { cancelled = true; };
  }, [email, page, queryKey]);

  const error = failure?.key === queryKey ? failure.message : null;
  const loading = !error && result?.key !== queryKey;
  const data = result?.key === queryKey ? result.data : null;
  const grants = data?.grants ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  const goTo = (next: { email?: string; page?: number }) => {
    const params: Record<string, string> = {};
    const e = next.email ?? email;
    if (e) params.email = e;
    const p = next.page ?? 1;
    if (p > 1) params.page = String(p);
    setSearchParams(params);
  };

  const closeAndReload = () => {
    setDialog({ kind: 'none' });
    setReloadKey((k) => k + 1);
  };

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

      <form
        role="search"
        aria-label="Filter by account"
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          goTo({ email: draft.trim().toLowerCase(), page: 1 });
        }}
      >
        <div className="space-y-1 w-full sm:w-80">
          <label htmlFor={filterId} className="block text-sm font-medium text-gray-200">Account email (exact)</label>
          <input
            id={filterId}
            type="email"
            autoComplete="off"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-describedby={filterHintId}
            className={ADMIN_FIELD_CLASS}
          />
        </div>
        <button
          type="submit"
          className="px-3 py-2 rounded-xl text-sm font-medium bg-dark-700 text-gray-200 hover:bg-dark-600
            focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
        >
          Find
        </button>
        {email && (
          <button
            type="button"
            onClick={() => { setDraft(''); setSearchParams({}); }}
            className="px-3 py-2 rounded-xl text-sm font-medium bg-dark-700 text-gray-200 hover:bg-dark-600
              focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
          >
            Show all
          </button>
        )}
        <p id={filterHintId} className="w-full text-xs text-gray-400">
          Each email lookup is recorded in the audit log.
        </p>
      </form>

      {loading ? (
        <div className="flex items-center justify-center h-48" role="status" aria-label="Loading free transfers">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="glass rounded-2xl p-6 border border-red-500/30">
          <p role="alert" className="text-red-400 text-sm">{error}</p>
        </div>
      ) : grants.length === 0 ? (
        <div className="glass rounded-2xl p-6">
          <p className="text-gray-400 text-sm">
            {email ? `No free transfers have been granted to ${email}.` : 'No free transfers have been granted yet.'}
          </p>
        </div>
      ) : (
        <section aria-label="Grants" className="glass rounded-2xl p-5 space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-gray-400">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-medium">Account</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Left</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Expires</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Reason</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Granted</th>
                  <th scope="col" className="py-2 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {grants.map((g) => {
                  const badge = STATUS_COPY[g.status];
                  return (
                    <tr key={g.id} className="align-top">
                      <td className="py-2 pr-4 text-gray-200 break-all">{g.userEmail ?? 'Deleted account'}</td>
                      <td className="py-2 pr-4 text-white">
                        {g.remaining} of {g.quantity}
                        <span className="block text-xs text-gray-400">{g.used} used</span>
                      </td>
                      <td className="py-2 pr-4 text-gray-200">{g.expiresAt ? fmtDate(g.expiresAt) : 'Never'}</td>
                      <td className="py-2 pr-4">
                        <span className={`px-2 py-0.5 rounded-lg text-xs font-medium border ${badge.className}`}>{badge.label}</span>
                      </td>
                      <td className="py-2 pr-4 text-gray-300 max-w-xs">
                        {g.reason}
                        {g.status === 'revoked' && (
                          <span className="block text-xs text-gray-400 mt-1">
                            Revoked {fmtDateTime(g.revokedAt)}{g.revokedBy ? ` by ${g.revokedBy}` : ''}
                            {g.revokeReason ? `: ${g.revokeReason}` : ''}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-gray-300">
                        {fmtDateTime(g.createdAt)}
                        {g.grantedBy && <span className="block text-xs text-gray-400">by {g.grantedBy}</span>}
                      </td>
                      <td className="py-2">
                        {g.status === 'active' && (
                          <button
                            type="button"
                            onClick={() => setDialog({ kind: 'revoke', grant: g })}
                            aria-label={`Revoke free transfers for ${g.userEmail ?? 'this account'}`}
                            className="px-3 py-1.5 rounded-xl text-xs font-medium bg-red-600/20 text-red-300 border border-red-500/30
                              hover:bg-red-600/30 focus:outline-none focus:ring-2 focus:ring-primary-500
                              focus:ring-offset-2 focus:ring-offset-dark-800"
                          >
                            Revoke…
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-sm">
              <button
                type="button"
                onClick={() => goTo({ page: page - 1 })}
                disabled={page <= 1}
                className="px-3 py-1.5 rounded-xl bg-dark-700 text-gray-200 hover:bg-dark-600 disabled:opacity-50
                  disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                Previous
              </button>
              <span className="text-gray-400">Page {page} of {pages}</span>
              <button
                type="button"
                onClick={() => goTo({ page: page + 1 })}
                disabled={page >= pages}
                className="px-3 py-1.5 rounded-xl bg-dark-700 text-gray-200 hover:bg-dark-600 disabled:opacity-50
                  disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                Next
              </button>
            </nav>
          )}
        </section>
      )}

      {dialog.kind === 'grant' && (
        <AdminGrantVouchersDialog open onClose={() => setDialog({ kind: 'none' })} onDone={closeAndReload} />
      )}
      {dialog.kind === 'revoke' && (
        <AdminRevokeVouchersDialog open grant={dialog.grant} onClose={() => setDialog({ kind: 'none' })} onDone={closeAndReload} />
      )}
    </div>
  );
};
