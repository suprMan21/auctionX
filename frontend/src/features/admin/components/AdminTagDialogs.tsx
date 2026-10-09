/**
 * S-ADMIN1 action dialogs: suspend/unsuspend and the token reset.
 * Every action needs a typed reason (min 10 chars, matching the API + DB rule).
 */

import { useEffect, useId, useState } from 'react';
import { adminApi, chipLabel, confirmationSuffixOf, type AdminTag } from '../api/adminApi';
import { AdminDialog, ADMIN_BUTTON_CLASS, ADMIN_FIELD_CLASS } from './AdminDialog';
import { confirmsChip, useEnrolledChips } from '../lib/chipConfirm';

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

  useEffect(() => {
    if (open) { setReason(''); setError(null); }
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.setTagSuspension(tag.id, suspend, reason.trim());
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The action failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      title={suspend ? `Suspend chip ${chipLabel(tag)}` : `Lift suspension on chip ${chipLabel(tag)}`}
      description={suspend
        ? 'The token will verify as invalid (reason: suspended) and cannot be transferred until the suspension is lifted. The tap counter is not changed.'
        : 'The token returns to Active and verifies normally again.'}
    >
      <ReasonField value={reason} onChange={setReason} />
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
          {busy ? 'Working…' : suspend ? 'Suspend token' : 'Lift suspension'}
        </button>
      </div>
    </AdminDialog>
  );
};

// ── Shared: replacement chip + typed confirmation ───────────────────────────

export const ReplacementChipField = (
  { candidates, loadError, value, onChange }:
  { candidates: AdminTag[] | null; loadError: string | null; value: string; onChange: (id: string) => void },
) => {
  const chipId = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={chipId} className="block text-sm font-medium text-gray-200">Replacement chip (enrolled, unclaimed)</label>
      {loadError ? (
        <ErrorLine message={loadError} />
      ) : candidates === null ? (
        <p className="text-sm text-gray-400">Loading enrolled chips…</p>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-amber-300">No enrolled chips are available. Encode one first.</p>
      ) : (
        <select id={chipId} value={value} onChange={(e) => onChange(e.target.value)} className={ADMIN_FIELD_CLASS}>
          <option value="">Choose a chip…</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {chipLabel(c)} (enrolled {c.registeredAt ? new Date(c.registeredAt).toLocaleDateString() : '—'})
            </option>
          ))}
        </select>
      )}
    </div>
  );
};

/**
 * The admin types the last 6 characters of the chip being retired: its serial on
 * a v2 chip (the whole lot shares UID …936980), else its UID.
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
        Expected: {expected} ({chip.serialSuffix ? 'end of the chip serial' : 'end of the chip UID'})
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

  useEffect(() => {
    if (open) { setNewTagId(''); setReason(''); setConfirm(''); setError(null); }
  }, [open]);

  const ready = Boolean(newTagId) && reason.trim().length >= REASON_MIN && confirmsChip(tag, confirm) && !busy;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.resetTag(tag.id, { newTagId, reason: reason.trim(), confirmSuffix: confirm.trim() });
      onDone(res.data.newTagId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The reset failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      danger
      title={`Reset token on chip ${chipLabel(tag)}`}
      description={
        <>
          <p>
            Ownership, the item link, disclosure settings and the full history move to the replacement chip, and the
            owner gets a new Ownership ID.
          </p>
          <p className="mt-2 font-semibold text-red-300">
            Chip {chipLabel(tag)} is retired permanently and marked for destruction. This cannot be undone.
          </p>
        </>
      }
    >
      <ReplacementChipField candidates={candidates} loadError={loadError} value={newTagId} onChange={setNewTagId} />
      <ReasonField value={reason} onChange={setReason} />
      <ConfirmChipField chip={tag} value={confirm} onChange={setConfirm} />
      <ErrorLine message={error} />

      <div className="flex justify-end gap-3">
        <button type="button" onClick={onClose} className={`${ADMIN_BUTTON_CLASS} bg-dark-700 text-gray-200 hover:bg-dark-600`}>
          Cancel
        </button>
        <button type="button" onClick={submit} disabled={!ready} className={`${ADMIN_BUTTON_CLASS} bg-red-600 hover:bg-red-500 text-white`}>
          {busy ? 'Resetting…' : 'Retire chip and reset token'}
        </button>
      </div>
    </AdminDialog>
  );
};
