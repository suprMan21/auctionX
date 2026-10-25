/**
 * S-ADMIN2 Ph1 account action dialogs: suspend, lift suspension, retire,
 * reactivate, delete and staff role. Every action needs a typed reason
 * (min 10 chars, matching the API + database rule). The server re-checks
 * every permission and writes the audit row.
 */

import { useEffect, useId, useState } from 'react';
import { adminApi } from '../api/adminApi';
import { GRANTABLE_ROLES, ROLE_LABELS, type AccountDetail, type GrantableRole } from '../api/accountSchemas';
import { AdminDialog, ADMIN_BUTTON_CLASS, ADMIN_FIELD_CLASS } from './AdminDialog';
import { ErrorLine, REASON_MIN, ReasonField } from './AdminTagDialogs';
import { deleteConfirmationOf } from '../lib/accountActions';

export type AccountAction = 'suspend' | 'unsuspend' | 'retire' | 'reactivate' | 'delete' | 'role';

const SUSPEND_OPTIONS = [
  { hours: 1, label: '1 hour' },
  { hours: 24, label: '24 hours' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '7 days' },
  { hours: 720, label: '30 days' },
] as const;


const COPY: Record<Exclude<AccountAction, 'role'>, { title: string; button: string; danger: boolean; body: string }> = {
  suspend: {
    title: 'Suspend account',
    button: 'Suspend account',
    danger: false,
    body: 'The account is signed out everywhere and cannot sign in or act on its tokens until the suspension ends or is lifted. Its tokens still verify.',
  },
  unsuspend: {
    title: 'Lift suspension',
    button: 'Lift suspension',
    danger: false,
    body: 'The account can sign in again straight away.',
  },
  retire: {
    title: 'Retire account',
    button: 'Retire account',
    danger: true,
    body: 'Step 1 of removing an account. It is signed out everywhere, cannot sign in, and loses any admin role. Its tokens still verify. You can reactivate it later; admin access is not restored.',
  },
  reactivate: {
    title: 'Reactivate account',
    button: 'Reactivate account',
    danger: false,
    body: 'The account can sign in again. Any admin role it had stays removed.',
  },
  delete: {
    title: 'Delete account',
    button: 'Delete account permanently',
    danger: true,
    body: 'This removes the sign-in account and profile for good. It cannot be undone. The audit history stays.',
  },
};

interface AccountDialogProps {
  open: boolean;
  action: AccountAction | null;
  account: AccountDetail;
  onClose: () => void;
  onDone: (action: AccountAction) => void;
}

export const AccountActionDialog = ({ open, action, account, onClose, onDone }: AccountDialogProps) => {
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState<number>(24);
  const [confirm, setConfirm] = useState('');
  const [role, setRole] = useState<GrantableRole | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hoursId = useId();
  const confirmId = useId();
  const confirmHintId = useId();
  const roleId = useId();

  useEffect(() => {
    if (open) {
      setReason('');
      setHours(24);
      setConfirm('');
      setRole(account.status === 'active' ? ((account.staff_role as GrantableRole | null) ?? '') : '');
      setError(null);
    }
  }, [open, account.staff_role, account.status]);

  if (!action) return null;

  const expectedConfirm = deleteConfirmationOf(account.email);
  const reasonOk = reason.trim().length >= REASON_MIN;
  const newRole: GrantableRole | null = role === '' ? null : role;
  const roleChanged = newRole !== (account.staff_role ?? null);
  const canSubmit =
    reasonOk &&
    !busy &&
    (action !== 'delete' || (expectedConfirm !== '' && confirm.trim().toLowerCase() === expectedConfirm.toLowerCase())) &&
    (action !== 'role' || roleChanged);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = reason.trim();
      if (action === 'suspend') await adminApi.suspendAccount(account.id, hours, r);
      else if (action === 'delete') await adminApi.deleteAccount(account.id, confirm.trim(), r);
      else if (action === 'role') await adminApi.setAccountRole(account.id, newRole, r);
      else await adminApi.accountAction(account.id, action, r);
      onDone(action);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The action failed');
    } finally {
      setBusy(false);
    }
  };

  const who = account.email ?? account.id;
  const copy = action === 'role'
    ? { title: 'Change staff role', button: 'Save role', danger: false, body: 'Only a super admin can do this. The change applies on the account’s next admin request.' }
    : COPY[action];

  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      danger={copy.danger}
      title={`${copy.title}: ${who}`}
      description={copy.body}
    >
      {action === 'suspend' && (
        <div className="space-y-1">
          <label htmlFor={hoursId} className="block text-sm font-medium text-gray-200">Length</label>
          <select id={hoursId} value={hours} onChange={(e) => setHours(Number(e.target.value))} className={ADMIN_FIELD_CLASS}>
            {SUSPEND_OPTIONS.map((o) => <option key={o.hours} value={o.hours}>{o.label}</option>)}
          </select>
        </div>
      )}

      {action === 'role' && (
        <div className="space-y-1">
          <label htmlFor={roleId} className="block text-sm font-medium text-gray-200">Staff role</label>
          <select id={roleId} value={role} onChange={(e) => setRole(e.target.value as GrantableRole | '')} className={ADMIN_FIELD_CLASS}>
            <option value="">No staff role</option>
            {/* Only an active account can be given a role; any account can lose one. */}
            {(account.status === 'active' ? GRANTABLE_ROLES : []).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </div>
      )}

      {action === 'delete' && (
        <div className="space-y-1">
          <label htmlFor={confirmId} className="block text-sm font-medium text-gray-200">
            Type <span className="font-mono text-white">{expectedConfirm}</span> to confirm
          </label>
          <input
            id={confirmId}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            aria-describedby={confirmHintId}
            className={ADMIN_FIELD_CLASS}
          />
          <p id={confirmHintId} className="text-xs text-gray-400">The part of the account email before the @.</p>
        </div>
      )}

      <ReasonField value={reason} onChange={setReason} />
      <ErrorLine message={error} />
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onClose} className={`${ADMIN_BUTTON_CLASS} bg-dark-700 text-gray-200 hover:bg-dark-600`}>
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className={`${ADMIN_BUTTON_CLASS} ${copy.danger ? 'bg-red-600 hover:bg-red-500' : action === 'suspend' ? 'bg-amber-600 hover:bg-amber-500' : 'bg-primary-600 hover:bg-primary-500'} text-white`}
        >
          {busy ? 'Working…' : copy.button}
        </button>
      </div>
    </AdminDialog>
  );
};
