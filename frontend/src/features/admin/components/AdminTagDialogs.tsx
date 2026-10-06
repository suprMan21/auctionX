/**
 * S-ADMIN1 action dialogs: suspend/unsuspend and the token reset.
 * Every action needs a typed reason (min 10 chars, matching the API + DB rule).
 */

import { useEffect, useId, useState } from 'react';
import { adminApi, type AdminTag } from '../api/adminApi';
import { AdminDialog, ADMIN_BUTTON_CLASS, ADMIN_FIELD_CLASS } from './AdminDialog';

export const REASON_MIN = 10;

const ReasonField = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
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

const ErrorLine = ({ message }: { message: string | null }) =>
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
      title={suspend ? `Suspend chip …${tag.uidSuffix}` : `Lift suspension on chip …${tag.uidSuffix}`}
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

// ── Token reset ─────────────────────────────────────────────────────────────

interface ResetDialogProps {
  open: boolean;
  tag: AdminTag;
  onClose: () => void;
  onDone: (newTagId: string) => void;
}

export const AdminResetDialog = ({ open, tag, onClose, onDone }: ResetDialogProps) => {
  const chipId = useId();
  const confirmId = useId();
  const confirmHintId = useId();
  const [candidates, setCandidates] = useState<AdminTag[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newTagId, setNewTagId] = useState('');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNewTagId(''); setReason(''); setConfirm(''); setError(null); setCandidates(null); setLoadError(null);
    let cancelled = false;
    adminApi
      .listTags({ status: 'ENROLLED', limit: 100 })
      .then((res) => { if (!cancelled) setCandidates(res.data.tags.filter((t) => t.id !== tag.id)); })
      .catch((err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load enrolled chips'); });
    return () => { cancelled = true; };
  }, [open, tag.id]);

  const confirmMatches = confirm.trim().toUpperCase() === tag.uidSuffix.toUpperCase();
  const ready = Boolean(newTagId) && reason.trim().length >= REASON_MIN && confirmMatches && !busy;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.resetTag(tag.id, { newTagId, reason: reason.trim(), confirmUidSuffix: confirm.trim() });
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
      title={`Reset token on chip …${tag.uidSuffix}`}
      description={
        <>
          <p>
            Ownership, the item link, disclosure settings and the full history move to the replacement chip, and the
            owner gets a new Ownership ID.
          </p>
          <p className="mt-2 font-semibold text-red-300">
            Chip …{tag.uidSuffix} is retired permanently and marked for destruction. This cannot be undone.
          </p>
        </>
      }
    >
      <div className="space-y-1">
        <label htmlFor={chipId} className="block text-sm font-medium text-gray-200">Replacement chip (enrolled, unclaimed)</label>
        {loadError ? (
          <ErrorLine message={loadError} />
        ) : candidates === null ? (
          <p className="text-sm text-gray-400">Loading enrolled chips…</p>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-amber-300">No enrolled chips are available. Encode one first.</p>
        ) : (
          <select id={chipId} value={newTagId} onChange={(e) => setNewTagId(e.target.value)} className={ADMIN_FIELD_CLASS}>
            <option value="">Choose a chip…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                …{c.uidSuffix} (enrolled {c.registeredAt ? new Date(c.registeredAt).toLocaleDateString() : '—'})
              </option>
            ))}
          </select>
        )}
      </div>

      <ReasonField value={reason} onChange={setReason} />

      <div className="space-y-1">
        <label htmlFor={confirmId} className="block text-sm font-medium text-gray-200">
          Type the last 6 characters of the chip being retired
        </label>
        <input
          id={confirmId}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          maxLength={6}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={confirmHintId}
          className={`${ADMIN_FIELD_CLASS} font-mono uppercase`}
        />
        <p id={confirmHintId} className="text-xs text-gray-400">Expected: {tag.uidSuffix}</p>
      </div>

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
