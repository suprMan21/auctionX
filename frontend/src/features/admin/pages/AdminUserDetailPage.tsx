/**
 * Admin account detail (S-ADMIN2 Ph1).
 * Shows the minimum support needs, the account's status, and the actions the
 * signed-in admin's permissions allow. Token holdings load only on request:
 * they need manage_nfc and every view is recorded in the audit log.
 * @module Module 10 — Admin Dashboard
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminApi } from '../api/adminApi';
import { DELETE_BLOCKER_TEXT, ROLE_LABELS, type AccountDetail, type AccountTokens } from '../api/accountSchemas';
import { hasPermission, PERMISSIONS, useAdminRole } from '../lib/adminRole';
import { AccountActionDialog, type AccountAction } from '../components/AdminAccountDialogs';
import { ADMIN_BUTTON_CLASS } from '../components/AdminDialog';
import { AccountStatusBadge } from './AdminUsersPage';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

const DONE_TEXT: Record<AccountAction, string> = {
  suspend: 'Account suspended and signed out everywhere.',
  unsuspend: 'Suspension lifted.',
  retire: 'Account retired and signed out everywhere.',
  reactivate: 'Account reactivated.',
  delete: 'Account deleted.',
  role: 'Staff role saved.',
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <dt className="text-xs text-gray-400 uppercase tracking-wider">{label}</dt>
    <dd className="text-sm text-white mt-1 break-words">{children}</dd>
  </div>
);

const ActionButton = ({ onClick, children, tone = 'neutral' }: { onClick: () => void; children: React.ReactNode; tone?: 'neutral' | 'warn' | 'danger' }) => (
  <button
    type="button"
    onClick={onClick}
    className={`${ADMIN_BUTTON_CLASS} min-h-[44px] text-white ${
      tone === 'danger' ? 'bg-red-600 hover:bg-red-500' : tone === 'warn' ? 'bg-amber-600 hover:bg-amber-500' : 'bg-dark-700 hover:bg-dark-600'
    }`}
  >
    {children}
  </button>
);

export const AdminUserDetailPage = () => {
  const { id = '' } = useParams<{ id: string }>();
  const access = useAdminRole();
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [dialog, setDialog] = useState<AccountAction | null>(null);
  const [tokens, setTokens] = useState<AccountTokens | null>(null);
  const [tokensError, setTokensError] = useState<string | null>(null);
  const [tokensBusy, setTokensBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setAccount(await adminApi.getAccount(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The account could not be loaded');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    setTokens(null);
    void load();
  }, [load]);

  const showTokens = async () => {
    setTokensBusy(true);
    setTokensError(null);
    try {
      setTokens(await adminApi.getAccountTokens(id));
    } catch (err) {
      setTokensError(err instanceof Error ? err.message : 'Tokens could not be loaded');
    } finally {
      setTokensBusy(false);
    }
  };

  const onDone = (action: AccountAction) => {
    setDialog(null);
    setNotice(DONE_TEXT[action]);
    if (action === 'delete') {
      setDeleted(true);
      return;
    }
    void load();
  };

  const back = (
    <Link to="/admin/users" className="text-sm text-gray-300 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded">
      ← All users
    </Link>
  );

  if (deleted) {
    return (
      <div className="space-y-4">
        {back}
        <div className="glass rounded-2xl p-6" role="status">
          <h1 className="text-xl font-semibold text-white">Account deleted</h1>
          <p className="text-sm text-gray-400 mt-1">The sign-in account and profile were removed. The audit history stays.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48" role="status" aria-label="Loading account">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !account) {
    return (
      <div className="space-y-4">
        {back}
        <p className="text-error-500 text-sm" role="alert">{error ?? 'Account not found'}</p>
      </div>
    );
  }

  const canManage = hasPermission(access, PERMISSIONS.manageUsers);
  const isSuperAdmin = hasPermission(access, PERMISSIONS.manageAdmins);
  // Acting on a staff account needs manage_admins; nobody acts on their own account.
  const mayAct = !account.is_self && (account.staff_role === null || isSuperAdmin);
  const { status } = account;

  return (
    <div className="space-y-6">
      {back}

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-white break-all">{account.email ?? account.id}</h1>
        <AccountStatusBadge status={status} />
        {account.staff_role && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-500/10 text-primary-300">
            {ROLE_LABELS[account.staff_role] ?? account.staff_role}
          </span>
        )}
      </div>

      {notice && <p role="status" className="text-sm text-success-500">{notice}</p>}

      <section className="glass rounded-2xl p-5" aria-label="Account details">
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label="Display name">{account.display_name ?? '—'}</Field>
          <Field label="Email confirmed">{account.email_confirmed ? 'Yes' : 'No'}</Field>
          <Field label="Age verified">{account.age_verified ? 'Yes' : 'No'}</Field>
          <Field label="Created">{when(account.created_at)}</Field>
          <Field label="Last sign-in">{when(account.last_sign_in_at)}</Field>
          <Field label="Active sessions">{account.active_sessions}</Field>
          <Field label="Pending transfers">{account.pending_transfers}</Field>
          <Field label="Account id"><span className="font-mono text-xs">{account.id}</span></Field>
        </dl>
      </section>

      {status === 'suspended' && (
        <section className="glass rounded-2xl p-5 border border-amber-500/30" aria-label="Suspension">
          <h2 className="text-base font-semibold text-white">Suspended until {when(account.suspended_until)}</h2>
          <p className="text-sm text-gray-300 mt-1">Reason: {account.suspension_reason ?? '—'}</p>
        </section>
      )}

      {status === 'retired' && (
        <section className="glass rounded-2xl p-5 border border-white/10" aria-label="Retirement">
          <h2 className="text-base font-semibold text-white">Retired {when(account.retired_at)}</h2>
          <p className="text-sm text-gray-300 mt-1">
            By {account.retired_by_email ?? '—'}. Reason: {account.retire_reason ?? '—'}
          </p>
          {account.delete && (
            <div className="mt-3 text-sm">
              {account.delete.blockers.length === 0 ? (
                <p className="text-gray-300">This account can be deleted.</p>
              ) : (
                <>
                  <p className="text-gray-300">Delete is not available yet:</p>
                  <ul className="list-disc pl-5 text-gray-400 mt-1 space-y-0.5">
                    {account.delete.blockers.map((b) => (
                      <li key={b}>
                        {DELETE_BLOCKER_TEXT[b] ?? b}
                        {b === 'delete_window_open' && account.delete?.eligible_at ? ` Available from ${when(account.delete.eligible_at)}.` : ''}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </section>
      )}

      {(canManage || isSuperAdmin) && (
        <section className="glass rounded-2xl p-5" aria-labelledby="actions-heading">
          <h2 id="actions-heading" className="text-base font-semibold text-white mb-3">Actions</h2>
          {account.is_self ? (
            <p className="text-sm text-gray-400">You cannot change your own account here.</p>
          ) : !mayAct ? (
            <p className="text-sm text-gray-400">This is a staff account. Only a super admin can change it.</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {canManage && status === 'active' && <ActionButton tone="warn" onClick={() => setDialog('suspend')}>Suspend</ActionButton>}
              {canManage && status === 'suspended' && <ActionButton onClick={() => setDialog('unsuspend')}>Lift suspension</ActionButton>}
              {canManage && status !== 'retired' && <ActionButton tone="danger" onClick={() => setDialog('retire')}>Retire</ActionButton>}
              {canManage && status === 'retired' && <ActionButton onClick={() => setDialog('reactivate')}>Reactivate</ActionButton>}
              {isSuperAdmin && status === 'active' && <ActionButton onClick={() => setDialog('role')}>Change staff role</ActionButton>}
              {isSuperAdmin && status === 'retired' && account.delete?.blockers.length === 0 && (
                <ActionButton tone="danger" onClick={() => setDialog('delete')}>Delete permanently</ActionButton>
              )}
            </div>
          )}
        </section>
      )}

      {hasPermission(access, PERMISSIONS.manageNfc) && (
        <section className="glass rounded-2xl p-5" aria-labelledby="tokens-heading">
          <h2 id="tokens-heading" className="text-base font-semibold text-white">Tokens and re-issues</h2>
          {!tokens ? (
            <div className="mt-2 space-y-2">
              <p className="text-sm text-gray-400">Token ownership is private. Viewing it is recorded in the audit log.</p>
              <button
                type="button"
                onClick={showTokens}
                disabled={tokensBusy}
                className={`${ADMIN_BUTTON_CLASS} min-h-[44px] bg-dark-700 hover:bg-dark-600 text-white`}
              >
                {tokensBusy ? 'Loading…' : 'Show tokens'}
              </button>
              {tokensError && <p role="alert" className="text-sm text-red-400">{tokensError}</p>}
            </div>
          ) : (
            <div className="mt-3 space-y-4">
              {tokens.tokens.length === 0 ? (
                <p className="text-sm text-gray-400">Owns no tokens.</p>
              ) : (
                <ul className="divide-y divide-white/5">
                  {tokens.tokens.map((t) => (
                    <li key={t.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                      <Link to={`/admin/tags/${t.id}`} className="text-sm text-white hover:text-primary-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded">
                        {t.chip_name ?? (t.serial_suffix ? `Token …${t.serial_suffix}` : t.id)}
                      </Link>
                      <span className="text-xs text-gray-400">{t.lifecycle_status ?? '—'}</span>
                    </li>
                  ))}
                </ul>
              )}
              {tokens.reissue_requests.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-200">Re-issue requests</h3>
                  <ul className="text-sm text-gray-400 mt-1 space-y-0.5">
                    {tokens.reissue_requests.map((r) => (
                      <li key={r.id}>{when(r.created_at)}: {r.status.toLowerCase()}{r.payment_status ? `, payment ${r.payment_status.toLowerCase()}` : ''}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {hasPermission(access, PERMISSIONS.viewAuditLogs) && (
        <Link
          to={`/admin/audit-logs?target=${account.id}`}
          className="inline-block text-sm text-primary-300 hover:text-primary-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
        >
          View this account&rsquo;s audit history →
        </Link>
      )}

      <AccountActionDialog
        open={dialog !== null}
        action={dialog}
        account={account}
        onClose={() => setDialog(null)}
        onDone={onDone}
      />
    </div>
  );
};
