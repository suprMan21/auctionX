/**
 * S-ADMIN1 Ph3b free-transfer dialogs: grant free transfers to an account by
 * email, and revoke a grant's unused ones. Both need a typed reason.
 */

import { useEffect, useId, useState } from 'react';
import { z } from 'zod';
import { adminApi } from '../api/adminApi';
import type { AdminVoucherGrant } from '../api/pricingSchemas';
import { AdminDialog, ADMIN_BUTTON_CLASS, ADMIN_FIELD_CLASS } from './AdminDialog';
import { ErrorLine, REASON_MIN, ReasonField } from './AdminTagDialogs';
import { VOUCHER_MAX_QUANTITY, endOfLocalDay, toIsoWithOffset } from '../lib/pricing';

const emailSchema = z.string().email().max(254);

const plural = (n: number): string => `${n} free ${n === 1 ? 'transfer' : 'transfers'}`;

interface GrantDialogProps {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

export const AdminGrantVouchersDialog = ({ open, onClose, onDone }: GrantDialogProps) => {
  const [email, setEmail] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [expiry, setExpiry] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailId = useId();
  const quantityId = useId();
  const quantityHintId = useId();
  const expiryId = useId();
  const expiryHintId = useId();

  useEffect(() => {
    if (open) { setEmail(''); setQuantity('1'); setExpiry(''); setReason(''); setError(null); }
  }, [open]);

  const normalisedEmail = email.trim().toLowerCase();
  const emailOk = emailSchema.safeParse(normalisedEmail).success;
  const qty = /^\d{1,3}$/.test(quantity.trim()) ? Number(quantity.trim()) : NaN;
  const qtyOk = Number.isInteger(qty) && qty >= 1 && qty <= VOUCHER_MAX_QUANTITY;
  const expiresAt = expiry ? endOfLocalDay(expiry) : null;
  // Checked at render time; the server rejects an expiry in the past anyway.
  const expiryOk = expiry === '' || (expiresAt !== null && expiresAt.getTime() > Date.now());
  const canSubmit = emailOk && qtyOk && expiryOk && reason.trim().length >= REASON_MIN && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.grantVouchers({
        email: normalisedEmail,
        quantity: qty,
        reason: reason.trim(),
        expiresAt: expiresAt ? toIsoWithOffset(expiresAt) : null,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The free transfers could not be granted');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      title="Grant free transfers"
      description="The account uses them automatically the next time it pays a transfer fee."
    >
      <div className="space-y-1">
        <label htmlFor={emailId} className="block text-sm font-medium text-gray-200">Account email</label>
        <input
          id={emailId}
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={ADMIN_FIELD_CLASS}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor={quantityId} className="block text-sm font-medium text-gray-200">How many</label>
        <input
          id={quantityId}
          type="number"
          inputMode="numeric"
          min={1}
          max={VOUCHER_MAX_QUANTITY}
          step={1}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          aria-invalid={!qtyOk && quantity !== '' ? true : undefined}
          aria-describedby={quantityHintId}
          className={ADMIN_FIELD_CLASS}
        />
        <p id={quantityHintId} className={`text-xs ${!qtyOk && quantity !== '' ? 'text-red-400' : 'text-gray-400'}`}>
          From 1 to {VOUCHER_MAX_QUANTITY}.
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor={expiryId} className="block text-sm font-medium text-gray-200">Expires (optional)</label>
        <input
          id={expiryId}
          type="date"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          aria-invalid={!expiryOk ? true : undefined}
          aria-describedby={expiryHintId}
          className={ADMIN_FIELD_CLASS}
        />
        <p id={expiryHintId} className={`text-xs ${expiryOk ? 'text-gray-400' : 'text-red-400'}`}>
          {expiryOk ? 'Leave empty for no expiry. They expire at the end of that day, your local time.' : 'Pick a date in the future.'}
        </p>
      </div>

      <ReasonField value={reason} onChange={setReason} />

      {emailOk && qtyOk && expiryOk && (
        <p className="text-sm text-gray-200" role="status">
          Gives {normalisedEmail} {plural(qty)}, {expiresAt ? `expiring ${expiresAt.toLocaleDateString()}` : 'with no expiry'}.
        </p>
      )}

      <ErrorLine message={error} />
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onClose} className={`${ADMIN_BUTTON_CLASS} bg-dark-700 text-gray-200 hover:bg-dark-600`}>
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className={`${ADMIN_BUTTON_CLASS} bg-primary-600 hover:bg-primary-500 text-white`}
        >
          {busy ? 'Granting…' : 'Grant'}
        </button>
      </div>
    </AdminDialog>
  );
};

interface RevokeDialogProps {
  open: boolean;
  grant: AdminVoucherGrant;
  onClose: () => void;
  onDone: () => void;
}

export const AdminRevokeVouchersDialog = ({ open, grant, onClose, onDone }: RevokeDialogProps) => {
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
      await adminApi.revokeVoucherGrant(grant.id, reason.trim());
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The grant could not be revoked');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      danger
      title="Revoke free transfers"
      description={
        `This cancels the ${plural(grant.remaining)} still unused from this grant` +
        `${grant.userEmail ? ` for ${grant.userEmail}` : ''}. Transfers already made with it are not affected. ` +
        'This cannot be undone.'
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
          className={`${ADMIN_BUTTON_CLASS} bg-red-600 hover:bg-red-500 text-white`}
        >
          {busy ? 'Working…' : 'Revoke'}
        </button>
      </div>
    </AdminDialog>
  );
};
