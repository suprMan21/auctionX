/**
 * S-ADMIN1 Ph3a stuck-payment dialogs: Re-apply and Refund. Both need a typed
 * reason; Refund also needs the end of the payment ID, like the chip
 * confirmation on a token reset.
 */

import { useEffect, useId, useState } from 'react';
import { adminApi, type AdminStuckPayment } from '../api/adminApi';
import { AdminDialog, ADMIN_BUTTON_CLASS, ADMIN_FIELD_CLASS } from './AdminDialog';
import { ErrorLine, REASON_MIN, ReasonField } from './AdminTagDialogs';
import { INTENT_SUFFIX_LENGTH, intentSuffix, moneyOf } from '../lib/stuckPayments';
import { ACTION_FAILED, errorMessage } from '../lib/display';

const subject = (p: AdminStuckPayment): string =>
  p.kind === 'transfer_fee' ? 'transfer' : 're-issue';

interface DialogProps {
  open: boolean;
  payment: AdminStuckPayment;
  onClose: () => void;
  onDone: () => void;
}

export const AdminReapplyPaymentDialog = ({ open, payment, onClose, onDone }: DialogProps) => {
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
      await adminApi.reapplyStuckPayment(payment.id, reason.trim());
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
      title="Re-apply this payment"
      description={
        payment.kind === 'transfer_fee'
          ? 'We check with Stripe that the payment is still paid, then complete the transfer exactly as the normal payment step would. The token moves to the recipient. If it has already been applied, nothing changes.'
          : 'We check with Stripe that the payment is still paid, then mark the re-issue as paid. You still move the token to a new chip on the Re-issues page.'
      }
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
          className={`${ADMIN_BUTTON_CLASS} bg-primary-600 hover:bg-primary-500 text-white`}
        >
          {busy ? 'Re-applying…' : 'Re-apply payment'}
        </button>
      </div>
    </AdminDialog>
  );
};

export const AdminRefundPaymentDialog = ({ open, payment, onClose, onDone }: DialogProps) => {
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmId = useId();
  const confirmHintId = useId();
  const expected = intentSuffix(payment.paymentIntentId);

  useEffect(() => {
    if (open) { setReason(''); setConfirm(''); setError(null); }
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.refundStuckPayment(payment.id, { reason: reason.trim(), confirmSuffix: confirm.trim() });
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
      danger
      title={`Refund ${moneyOf(payment.amount, payment.currency)}`}
      description={
        <>
          <p>
            The full amount goes back to the payer through Stripe. This cannot be undone.
            {payment.kind === 'transfer_fee' && payment.target?.status === 'PENDING'
              ? ' The transfer is cancelled and the token stays with its current owner.'
              : ` The ${subject(payment)} is left as it is.`}
          </p>
          {payment.reason === 'no_recipient' || payment.reason === 'apply_failed' || payment.reason === 'webhook_missed' ? (
            <p className="mt-2 text-amber-300">We may still be able to apply this payment. Try Re-apply first.</p>
          ) : null}
        </>
      }
    >
      <ReasonField value={reason} onChange={setReason} />
      <div className="space-y-1">
        <label htmlFor={confirmId} className="block text-sm font-medium text-gray-200">
          Type the last {INTENT_SUFFIX_LENGTH} characters of the payment ID
        </label>
        <input
          id={confirmId}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          maxLength={INTENT_SUFFIX_LENGTH}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={confirmHintId}
          className={`${ADMIN_FIELD_CLASS} font-mono`}
        />
        <p id={confirmHintId} className="text-xs text-gray-400">Expected: {expected}</p>
      </div>
      <ErrorLine message={error} />
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onClose} className={`${ADMIN_BUTTON_CLASS} bg-dark-700 text-gray-200 hover:bg-dark-600`}>
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy || reason.trim().length < REASON_MIN || confirm.trim() !== expected}
          className={`${ADMIN_BUTTON_CLASS} bg-red-600 hover:bg-red-500 text-white`}
        >
          {busy ? 'Refunding…' : 'Refund payment'}
        </button>
      </div>
    </AdminDialog>
  );
};
