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
import { ACTION_FAILED, errorMessage } from '../lib/display';
import { type ApprovalPending } from '../api/approvalSchemas';
import { ApprovalHelper, ApprovalSentPanel } from './ApprovalSent';
import { needsApproval, useAdminRole } from '../lib/adminRole';
import { useWorkQueues } from '../lib/workQueues';
import { APPROVAL_COPY } from '../lib/labels';

export type AccountAction = 'suspend' | 'unsuspend' | 'retire' | 'reactivate' | 'delete' | 'role' | 'type';

/** Account type choices in the dialog. creator_override = Creator without an ID check. */
type TypeChoice = 'collector' | 'creator' | 'creator_override';

const CHECK_PASSED = new Set(['VERIFIED', 'APPROVED']);

export const currentTypeChoice = (a: AccountDetail): TypeChoice => {
  if (a.creator_override_at) return 'creator_override';
  if (a.account_type === 'creator' || a.creator_requested_at) return 'creator';
  return 'collector';
};

const SUSPEND_OPTIONS = [
  { hours: 1, label: '1 hour' },
  { hours: 24, label: '24 hours' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '7 days' },
  { hours: 720, label: '30 days' },
] as const;


const COPY: Record<Exclude<AccountAction, 'role' | 'type'>, { title: string; button: string; busy: string; danger: boolean; body: string }> = {
  suspend: {
    title: 'Suspend account',
    button: 'Suspend account',
    busy: 'Suspending…',
    danger: false,
    body: 'The account is signed out everywhere and cannot sign in or act on its tokens until the suspension ends or is lifted. Its tokens still verify.',
  },
  unsuspend: {
    title: 'Lift suspension',
    button: 'Lift suspension',
    busy: 'Lifting suspension…',
    danger: false,
    body: 'The account can sign in again straight away.',
  },
  retire: {
    title: 'Retire account',
    button: 'Retire account',
    busy: 'Retiring…',
    danger: true,
    body: 'This is step 1 of deleting an account. It is signed out everywhere, cannot sign in, and loses any staff role. Its tokens still verify. You can reactivate it later, but the staff role does not come back.',
  },
  reactivate: {
    title: 'Reactivate account',
    button: 'Reactivate account',
    busy: 'Reactivating…',
    danger: false,
    body: 'The account can sign in again. Any staff role it had stays removed.',
  },
  delete: {
    title: 'Delete account',
    button: 'Delete account permanently',
    busy: 'Deleting…',
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
  const [typeChoice, setTypeChoice] = useState<TypeChoice>('collector');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<ApprovalPending | null>(null);
  const approverNeeded = needsApproval(useAdminRole());
  const { refresh: refreshQueues } = useWorkQueues();
  const hoursId = useId();
  const confirmId = useId();
  const confirmHintId = useId();
  const roleName = useId();
  const typeName = useId();

  useEffect(() => {
    if (open) {
      setReason('');
      setHours(24);
      setConfirm('');
      setRole(account.status === 'active' ? ((account.staff_role as GrantableRole | null) ?? '') : '');
      setTypeChoice(currentTypeChoice(account));
      setError(null);
      setSent(null);
    }
  }, [open, account]);

  if (!action) return null;
  // S-2FA Ph3a: suspend and retire wait for a second admin when /admin/me says so.
  const approval = approverNeeded && (action === 'suspend' || action === 'retire');

  const expectedConfirm = deleteConfirmationOf(account.email);
  const reasonOk = reason.trim().length >= REASON_MIN;
  const newRole: GrantableRole | null = role === '' ? null : role;
  const roleChanged = newRole !== (account.staff_role ?? null);
  const canSubmit =
    reasonOk &&
    !busy &&
    (action !== 'delete' || (expectedConfirm !== '' && confirm.trim().toLowerCase() === expectedConfirm.toLowerCase())) &&
    (action !== 'role' || roleChanged) &&
    (action !== 'type' || typeChoice !== currentTypeChoice(account));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = reason.trim();
      let pending: ApprovalPending | null | undefined = null;
      if (action === 'suspend') pending = await adminApi.suspendAccount(account.id, hours, r);
      else if (action === 'retire') pending = await adminApi.accountAction(account.id, action, r);
      else if (action === 'delete') await adminApi.deleteAccount(account.id, confirm.trim(), r);
      else if (action === 'role') await adminApi.setAccountRole(account.id, newRole, r);
      else if (action === 'type') {
        await adminApi.setAccountType(account.id, typeChoice === 'collector' ? 'collector' : 'creator', typeChoice === 'creator_override', r);
      }
      else await adminApi.accountAction(account.id, action, r);
      if (pending) { setSent(pending); refreshQueues(); return; }
      onDone(action);
    } catch (err) {
      setError(errorMessage(err, ACTION_FAILED));
    } finally {
      setBusy(false);
    }
  };

  const who = account.email ?? account.id;
  const checkPassed = CHECK_PASSED.has(account.creator_check_status);
  const current = currentTypeChoice(account);
  // An override is removed by going back to Collector, so the plain Creator
  // option is not offered while one is in place.
  const typeOptions: ReadonlyArray<{ value: TypeChoice; label: string; hint: string }> = [
    { value: 'collector', label: 'Collector', hint: 'Clears any creator request.' },
    ...(current === 'creator_override' ? [] : [{
      value: 'creator' as const,
      label: 'Creator',
      hint: checkPassed ? 'ID check passed: creator straight away.' : 'Shows as Creator (verifying) until their ID check passes.',
    }]),
    ...(checkPassed && current !== 'creator_override' ? [] : [{
      value: 'creator_override' as const,
      label: 'Creator now, skip the ID check',
      hint: 'Override. Recorded with your name in the audit log.',
    }]),
  ];
  const copy = action === 'role'
    ? { title: 'Change staff role', button: 'Save staff role', busy: 'Saving…', danger: false, body: 'Only a super admin can do this. The change takes effect straight away. Changing or removing a role also signs the account out.' }
    : action === 'type'
    ? { title: 'Change account type', button: 'Save account type', busy: 'Saving…', danger: false, body: 'A creator normally needs a passed ID check. Admins and super admins can skip it.' }
    : COPY[action];

  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      danger={copy.danger}
      title={`${copy.title}: ${who}`}
      description={copy.body}
    >
      {sent ? <ApprovalSentPanel approval={sent} onClose={onClose} /> : (<>
      {action === 'suspend' && (
        <div className="space-y-1">
          <label htmlFor={hoursId} className="block text-sm font-medium text-gray-200">Length</label>
          <select id={hoursId} value={hours} onChange={(e) => setHours(Number(e.target.value))} className={ADMIN_FIELD_CLASS}>
            {SUSPEND_OPTIONS.map((o) => <option key={o.hours} value={o.hours}>{o.label}</option>)}
          </select>
        </div>
      )}

      {action === 'role' && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-gray-200">Staff role</legend>
          {/* Only an active account can be given a role; any account can lose one. Choosing only sets the form. */}
          {(['', ...(account.status === 'active' ? GRANTABLE_ROLES : [])] as const).map((r) => (
            <label
              key={r || 'none'}
              className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm text-gray-200 cursor-pointer hover:bg-dark-700
                has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-500"
            >
              <input
                type="radio"
                name={roleName}
                value={r}
                checked={role === r}
                onChange={() => setRole(r)}
                className="h-4 w-4 accent-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              {r === '' ? 'No staff role' : ROLE_LABELS[r]}
              {r === (account.staff_role ?? '') && <span className="text-xs text-gray-400"> (current)</span>}
            </label>
          ))}
        </fieldset>
      )}

      {action === 'type' && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-gray-200">Account type</legend>
          {typeOptions.map((o) => (
            <label
              key={o.value}
              className="flex min-h-[44px] items-start gap-3 rounded-xl px-3 py-2 text-sm text-gray-200 cursor-pointer hover:bg-dark-700
                has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-500"
            >
              <input
                type="radio"
                name={typeName}
                value={o.value}
                checked={typeChoice === o.value}
                onChange={() => setTypeChoice(o.value)}
                className="mt-0.5 h-4 w-4 accent-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <span>
                <span className="block">
                  {o.label}
                  {o.value === current && <span className="text-xs text-gray-400"> (current)</span>}
                </span>
                <span className="block text-xs text-gray-400">{o.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
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
      {approval && <ApprovalHelper />}
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
          {approval ? (busy ? APPROVAL_COPY.busy : APPROVAL_COPY.button) : busy ? copy.busy : copy.button}
        </button>
      </div>
      </>)}
    </AdminDialog>
  );
};
