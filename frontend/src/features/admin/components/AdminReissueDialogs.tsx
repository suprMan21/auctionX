/**
 * S-ADMIN1 Ph2 re-issue dialogs: review (approve / approve without fee / reject)
 * and fulfil. Every action needs a typed reason; fulfil also needs the chip
 * confirmation, exactly like the token reset.
 */

import { useEffect, useState } from 'react';
import { adminApi, chipLabel, type AdminReissueRequest } from '../api/adminApi';
import { AdminDialog, ADMIN_BUTTON_CLASS } from './AdminDialog';
import { ConfirmChipField, ErrorLine, REASON_MIN, ReasonField, ReplacementChipField } from './AdminTagDialogs';
import { confirmsChip, useEnrolledChips } from '../lib/chipConfirm';

export type ReissueDecision = 'approve' | 'approve_waived' | 'reject';

const chipOf = (r: AdminReissueRequest): string =>
  r.tag ? chipLabel(r.tag) : r.tagId.slice(0, 8);

const DECISION_COPY: Record<ReissueDecision, { title: string; description: string; button: string; tone: string }> = {
  approve: {
    title: 'Approve replacement',
    description:
      'The owner is emailed a link to pay the replacement fee on the website. Nothing is charged until they pay, and you fulfil only after payment arrives.',
    button: 'Approve and request payment',
    tone: 'bg-primary-600 hover:bg-primary-500',
  },
  approve_waived: {
    title: 'Approve without the fee',
    description:
      'No payment is taken. The request goes straight to Ready for a chip. Use this only when the problem is our fault. Your reason is recorded as the waiver reason.',
    button: 'Approve with no fee',
    tone: 'bg-amber-600 hover:bg-amber-500',
  },
  reject: {
    title: 'Reject replacement',
    description:
      'Nothing is charged and the token stays on its current chip. The owner is emailed that the request was not approved. Your reason stays internal.',
    button: 'Reject request',
    tone: 'bg-red-600 hover:bg-red-500',
  },
};

interface ReviewDialogProps {
  open: boolean;
  request: AdminReissueRequest;
  decision: ReissueDecision;
  onClose: () => void;
  onDone: () => void;
}

export const AdminReissueReviewDialog = ({ open, request, decision, onClose, onDone }: ReviewDialogProps) => {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = DECISION_COPY[decision];

  useEffect(() => {
    if (open) { setReason(''); setError(null); }
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.reviewReissue(request.id, decision, reason.trim());
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
      danger={decision === 'reject'}
      title={`${copy.title} for chip ${chipOf(request)}`}
      description={copy.description}
    >
      {request.tag && !request.tag.requesterStillOwner && decision !== 'reject' && (
        <p role="alert" className="text-sm text-amber-300">
          The requester no longer owns this token. Approval will be refused.
        </p>
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
          disabled={busy || reason.trim().length < REASON_MIN}
          className={`${ADMIN_BUTTON_CLASS} ${copy.tone} text-white`}
        >
          {busy ? 'Working…' : copy.button}
        </button>
      </div>
    </AdminDialog>
  );
};

interface FulfilDialogProps {
  open: boolean;
  request: AdminReissueRequest;
  onClose: () => void;
  onDone: (newTagId: string) => void;
}

export const AdminReissueFulfilDialog = ({ open, request, onClose, onDone }: FulfilDialogProps) => {
  const { candidates, loadError } = useEnrolledChips(open, request.tagId);
  const [newTagId, setNewTagId] = useState('');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setNewTagId(''); setReason(''); setConfirm(''); setError(null); }
  }, [open]);

  const chip = request.tag ? { uidSuffix: request.tag.uidSuffix, serialSuffix: request.tag.serialSuffix } : null;
  const ready = Boolean(chip) && Boolean(newTagId) && reason.trim().length >= REASON_MIN
    && chip !== null && confirmsChip(chip, confirm) && !busy;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.fulfilReissue(request.id, { newTagId, reason: reason.trim(), confirmSuffix: confirm.trim() });
      onDone(res.data.newTagId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fulfilment failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      danger
      title={`Fulfil replacement for chip ${chipOf(request)}`}
      description={
        <>
          <p>
            The token moves to the replacement chip with the same owner, and the owner gets a new Ownership ID.
            Encode and enroll the replacement chip first.
          </p>
          <p className="mt-2 font-semibold text-red-300">
            Chip {chipOf(request)} is retired permanently and marked for destruction. This cannot be undone.
          </p>
        </>
      }
    >
      <ReplacementChipField candidates={candidates} loadError={loadError} value={newTagId} onChange={setNewTagId} />
      <ReasonField value={reason} onChange={setReason} />
      {chip ? <ConfirmChipField chip={chip} value={confirm} onChange={setConfirm} /> : <ErrorLine message="Chip details could not be loaded." />}
      <ErrorLine message={error} />
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onClose} className={`${ADMIN_BUTTON_CLASS} bg-dark-700 text-gray-200 hover:bg-dark-600`}>
          Cancel
        </button>
        <button type="button" onClick={submit} disabled={!ready} className={`${ADMIN_BUTTON_CLASS} bg-red-600 hover:bg-red-500 text-white`}>
          {busy ? 'Fulfilling…' : 'Retire old chip and move token'}
        </button>
      </div>
    </AdminDialog>
  );
};
