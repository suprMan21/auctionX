/**
 * S-ADMIN1 action dialogs: suspend/unsuspend and the token reset ("Move token
 * to a new chip" on screen).
 * Every action needs a typed reason (min 10 chars, matching the API + DB rule).
 */

import { useEffect, useId, useState } from 'react';
import { adminApi, chipLabel, confirmationSuffixOf, type AdminTag } from '../api/adminApi';
import { AdminDialog, ADMIN_BUTTON_CLASS, ADMIN_FIELD_CLASS } from './AdminDialog';
import { confirmsChip, useEnrolledChips } from '../lib/chipConfirm';
import { ACTION_FAILED, errorMessage } from '../lib/display';
import { ChipCombobox } from './ChipCombobox';
import { pendingApprovalOf, type ApprovalPending } from '../api/approvalSchemas';
import { ApprovalHelper, ApprovalSentPanel, HoldHelper } from './ApprovalSent';
import { needsApproval, useAdminRole } from '../lib/adminRole';
import { useWorkQueues } from '../lib/workQueues';
import { APPROVAL_COPY } from '../lib/labels';

export const REASON_MIN = 10;

export const ReasonField = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
  const id = useId();
  const hintId = useId();
  const short = value.trim().length < REASON_MIN;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-gray-200">Reason (recorded in the audit log)</label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        maxLength={500}
        aria-describedby={hintId}
        className={ADMIN_FIELD_CLASS}
      />
      <p id={hintId} className="text-xs text-gray-400">
        At least {REASON_MIN} characters.{short && value.length > 0 ? ` ${REASON_MIN - value.trim().length} more needed.` : ''}
      </p>
    </div>
  );
};

export const ErrorLine = ({ message }: { message: string | null }) =>
  message ? <p role="alert" className="text-sm text-red-400">{message}</p> : null;

// ── Suspend / unsuspend ─────────────────────────────────────────────────────

interface SuspendDialogProps {
  open: boolean;
  tag: AdminTag;
  /** true = suspend, false = unsuspend */
  suspend: boolean;
  onClose: () => void;
  onDone: () => void;
}

export const AdminSuspendDialog = ({ open, tag, suspend, onClose, onDone }: SuspendDialogProps) => {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<ApprovalPending | null>(null);
  // S-2FA Ph3a: suspending waits for a second admin. Ph3a2: lifting waits only when another
  // admin set the suspension, which only the server knows; the button keeps its normal label.
  const access = useAdminRole();
  const approverNeeded = needsApproval(access);
  const approval = suspend && approverNeeded;
  const liftMayWait = !suspend && approverNeeded;
  const { refresh: refreshQueues } = useWorkQueues();

  useEffect(() => {
    if (open) { setReason(''); setError(null); setSent(null); }
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.setTagSuspension(tag.id, suspend, reason.trim());
      const pending = pendingApprovalOf(res);
      if (pending) { setSent(pending); refreshQueues(); return; }
      onDone();
    } catch (err) {
      setError(errorMessage(err, ACTION_FAILED));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      title={suspend ? `Suspend token ${chipLabel(tag)}` : `Lift suspension on token ${chipLabel(tag)}`}
      description={suspend
        ? 'Taps will show the token as suspended, and it cannot be transferred until you lift the suspension.'
        : 'The token is active again and verifies normally.'}
    >
      {sent ? <ApprovalSentPanel approval={sent} onClose={onClose} /> : (<>
      <ReasonField value={reason} onChange={setReason} />
      {approval && <ApprovalHelper />}
      {liftMayWait && <HoldHelper />}
      <ErrorLine message={error} />
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onClose} className={`${ADMIN_BUTTON_CLASS} bg-dark-700 text-gray-200 hover:bg-dark-600`}>
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy || reason.trim().length < REASON_MIN}
          className={`${ADMIN_BUTTON_CLASS} ${suspend ? 'bg-amber-600 hover:bg-amber-500' : 'bg-primary-600 hover:bg-primary-500'} text-white`}
        >
          {approval
            ? (busy ? APPROVAL_COPY.busy : APPROVAL_COPY.button)
            : busy ? (suspend ? 'Suspending…' : 'Lifting suspension…') : suspend ? 'Suspend token' : 'Lift suspension'}
        </button>
      </div>
      </>)}
    </AdminDialog>
  );
};

// ── Shared: replacement chip + typed confirmation ───────────────────────────

/** The replacement chip, chosen by typing its name (UX-2). Choosing never calls the API. */
export const ReplacementChipField = (
  { candidates, loadError, value, onChange }:
  { candidates: AdminTag[] | null; loadError: string | null; value: string; onChange: (id: string) => void },
) => <ChipCombobox candidates={candidates} loadError={loadError} value={value} onChange={onChange} />;

/**
 * The admin types the last 6 characters of the chip being retired: its serial on
 * a v2 chip (the whole lot shares UID …936980), else its UID. On screen the
 * UID is called the chip's hardware ID.
 */
export const ConfirmChipField = (
  { chip, value, onChange }:
  { chip: Pick<AdminTag, 'uidSuffix' | 'serialSuffix'>; value: string; onChange: (v: string) => void },
) => {
  const confirmId = useId();
  const confirmHintId = useId();
  const expected = confirmationSuffixOf(chip);
  return (
    <div className="space-y-1">
      <label htmlFor={confirmId} className="block text-sm font-medium text-gray-200">
        Type the last 6 characters of the chip being retired
      </label>
      <input
        id={confirmId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={6}
        autoComplete="off"
        spellCheck={false}
        aria-describedby={confirmHintId}
        className={`${ADMIN_FIELD_CLASS} font-mono uppercase`}
      />
      <p id={confirmHintId} className="text-xs text-gray-400">
        Expected: {expected} ({chip.serialSuffix ? 'end of the chip serial number' : "end of the chip's hardware ID"})
      </p>
    </div>
  );
};

// ── Token reset ─────────────────────────────────────────────────────────────

interface ResetDialogProps {
  open: boolean;
  tag: AdminTag;
  onClose: () => void;
  onDone: (newTagId: string) => void;
}

export const AdminResetDialog = ({ open, tag, onClose, onDone }: ResetDialogProps) => {
  const { candidates, loadError } = useEnrolledChips(open, tag.id);
  const [newTagId, setNewTagId] = useState('');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<ApprovalPending | null>(null);
  const approval = needsApproval(useAdminRole());
  const { refresh: refreshQueues } = useWorkQueues();

  useEffect(() => {
    if (open) { setNewTagId(''); setReason(''); setConfirm(''); setError(null); setSent(null); }
  }, [open]);

  const ready = Boolean(newTagId) && reason.trim().length >= REASON_MIN && confirmsChip(tag, confirm) && !busy;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.resetTag(tag.id, { newTagId, reason: reason.trim(), confirmSuffix: confirm.trim() });
      const pending = pendingApprovalOf(res);
      if (pending) { setSent(pending); refreshQueues(); return; }
      if ('newTagId' in res.data) onDone(res.data.newTagId);
    } catch (err) {
      setError(errorMessage(err, ACTION_FAILED));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      danger
      title="Move token to a new chip"
      description={
        <>
          <p>
            Token {chipLabel(tag)} moves to the replacement chip. Ownership, the item link, disclosure settings and the
            full history move with it, and the owner gets a new Ownership ID.
          </p>
          <p className="mt-2 font-semibold text-red-300">
            Chip {chipLabel(tag)} is retired permanently and marked for destruction. This cannot be undone.
          </p>
        </>
      }
    >
      {sent ? <ApprovalSentPanel approval={sent} onClose={onClose} /> : (<>
      <ReplacementChipField candidates={candidates} loadError={loadError} value={newTagId} onChange={setNewTagId} />
      <ReasonField value={reason} onChange={setReason} />
      <ConfirmChipField chip={tag} value={confirm} onChange={setConfirm} />
      {approval && <ApprovalHelper />}
      <ErrorLine message={error} />

      <div className="flex justify-end gap-3">
        <button type="button" onClick={onClose} className={`${ADMIN_BUTTON_CLASS} bg-dark-700 text-gray-200 hover:bg-dark-600`}>
          Cancel
        </button>
        <button type="button" onClick={submit} disabled={!ready} className={`${ADMIN_BUTTON_CLASS} bg-red-600 hover:bg-red-500 text-white`}>
          {approval ? (busy ? APPROVAL_COPY.busy : APPROVAL_COPY.button) : busy ? 'Moving…' : 'Move token and retire old chip'}
        </button>
      </div>
      </>)}
    </AdminDialog>
  );
};
