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
import { ACTION_FAILED, errorMessage } from '../lib/display';
import { pendingApprovalOf, type ApprovalPending } from '../api/approvalSchemas';
import { ApprovalSentPanel } from './ApprovalSent';
import { needsApproval, useAdminRole } from '../lib/adminRole';
import { useWorkQueues } from '../lib/workQueues';
import { APPROVAL_COPY } from '../lib/labels';

export type ReissueDecision = 'approve' | 'approve_waived' | 'reject';

const chipOf = (r: AdminReissueRequest): string =>
  r.tag ? chipLabel(r.tag) : r.tagId.slice(0, 8);

const DECISION_COPY: Record<ReissueDecision, { title: string; description: string; button: string; busy: string; tone: string }> = {
  approve: {
    title: 'Approve re-issue',
    description:
      'The owner is emailed a link to pay the re-issue fee on the website. Nothing is charged until they pay, and you move the token to a new chip only after payment arrives.',
    button: 'Approve and request payment',
    busy: 'Approving…',
    tone: 'bg-primary-600 hover:bg-primary-500',
  },
  approve_waived: {
    title: 'Approve without the fee',
    description:
      'No payment is taken. It is ready for a new chip straight away. Use this only when the problem is our fault. Your reason is recorded as the reason for waiving the fee.',
    button: 'Approve with no fee',
    busy: 'Approving…',
    tone: 'bg-amber-600 hover:bg-amber-500',
  },
  reject: {
    title: 'Reject re-issue',
    description:
      'Nothing is charged and the token stays on its current chip. The owner is emailed that the request was not approved. Your reason stays internal.',
    button: 'Reject request',
    busy: 'Rejecting…',
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
      setError(errorMessage(err, ACTION_FAILED));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      danger={decision === 'reject'}
      title={`${copy.title} for ${chipOf(request)}`}
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
          {busy ? copy.busy : copy.button}
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
  const [sent, setSent] = useState<ApprovalPending | null>(null);
  // S-2FA Ph3a2: a re-issue fulfil always waits for a second admin (super_admin acts alone).
  const approval = needsApproval(useAdminRole());
  const { refresh: refreshQueues } = useWorkQueues();

  useEffect(() => {
    if (open) { setNewTagId(''); setReason(''); setConfirm(''); setError(null); setSent(null); }
  }, [open]);

  const chip = request.tag ? { uidSuffix: request.tag.uidSuffix, serialSuffix: request.tag.serialSuffix } : null;
  const ready = Boolean(chip) && Boolean(newTagId) && reason.trim().length >= REASON_MIN
    && chip !== null && confirmsChip(chip, confirm) && !busy;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.fulfilReissue(request.id, { newTagId, reason: reason.trim(), confirmSuffix: confirm.trim() });
      const pending = pendingApprovalOf(res);
      if (pending) { setSent(pending); refreshQueues(); return; }
      if ('newTagId' in res.data) onDone(res.data.newTagId);
    } catch (err) {
      setError(errorMessage(err, 'The re-issue could not be completed. Nothing was changed. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      danger
      title={`Complete re-issue for ${chipOf(request)}`}
      description={
        <>
          <p>
            The token moves to the replacement chip with the same owner, and the owner gets a new Ownership ID.
            Set up the new chip with the encoder first.
          </p>
          <p className="mt-2 font-semibold text-red-300">
            Chip {chipOf(request)} is retired permanently and marked for destruction. This cannot be undone.
          </p>
        </>
      }
    >
      {sent ? <ApprovalSentPanel approval={sent} onClose={onClose} /> : (<>
      <ReplacementChipField candidates={candidates} loadError={loadError} value={newTagId} onChange={setNewTagId} />
      <ReasonField value={reason} onChange={setReason} />
      {chip ? <ConfirmChipField chip={chip} value={confirm} onChange={setConfirm} /> : <ErrorLine message="Chip details could not be loaded." />}
      {approval && <p className="text-sm text-amber-200">{APPROVAL_COPY.fulfilHelper}</p>}
      <ErrorLine message={error} />
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onClose} className={`${ADMIN_BUTTON_CLASS} bg-dark-700 text-gray-200 hover:bg-dark-600`}>
          Cancel
        </button>
        <button type="button" onClick={submit} disabled={!ready} className={`${ADMIN_BUTTON_CLASS} bg-red-600 hover:bg-red-500 text-white`}>
          {approval
            ? (busy ? APPROVAL_COPY.busy : APPROVAL_COPY.button)
            : busy ? 'Moving…' : 'Move token and retire old chip'}
        </button>
      </div>
      </>)}
    </AdminDialog>
  );
};
