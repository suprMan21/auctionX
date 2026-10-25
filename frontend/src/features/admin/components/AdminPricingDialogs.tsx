/**
 * S-ADMIN1 Ph3b price dialogs: set a price (now or scheduled) and cancel a
 * scheduled change. Both need a typed reason for the audit log.
 */

import { useEffect, useId, useState } from 'react';
import { adminApi } from '../api/adminApi';
import { PRICE_KINDS, type AdminPriceChange, type AdminPricing, type PriceKind } from '../api/pricingSchemas';
import { AdminDialog, ADMIN_BUTTON_CLASS, ADMIN_FIELD_CLASS } from './AdminDialog';
import { ErrorLine, REASON_MIN, ReasonField } from './AdminTagDialogs';
import {
  PRICE_LABEL,
  PRICE_MAX_CENTS,
  PRICE_MIN_CENTS,
  fmtDateTime,
  parseDollarsToCents,
  parseLocalDateTime,
  toIsoWithOffset,
  usd,
} from '../lib/pricing';

interface SetPriceDialogProps {
  open: boolean;
  current: AdminPricing['current'];
  onClose: () => void;
  onDone: () => void;
}

type When = 'now' | 'schedule';

export const AdminSetPriceDialog = ({ open, current, onClose, onDone }: SetPriceDialogProps) => {
  const [kind, setKind] = useState<PriceKind>('transfer');
  const [amount, setAmount] = useState('');
  const [when, setWhen] = useState<When>('now');
  const [startsAt, setStartsAt] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kindId = useId();
  const amountId = useId();
  const amountHintId = useId();
  const startsId = useId();
  const startsHintId = useId();

  useEffect(() => {
    if (open) {
      setKind('transfer'); setAmount(''); setWhen('now'); setStartsAt(''); setReason(''); setError(null);
    }
  }, [open]);

  const cents = parseDollarsToCents(amount);
  const amountOk = cents !== null && cents >= PRICE_MIN_CENTS && cents <= PRICE_MAX_CENTS;
  const amountProblem = amount.trim() !== '' && !amountOk
    ? `Enter an amount from ${usd(PRICE_MIN_CENTS)} to ${usd(PRICE_MAX_CENTS)}.`
    : null;

  const start = when === 'schedule' ? parseLocalDateTime(startsAt) : null;
  // Checked at render time; the server rejects a start in the past anyway.
  const startInFuture = start !== null && start.getTime() > Date.now();
  const whenOk = when === 'now' || startInFuture;
  const startProblem = when === 'schedule' && startsAt !== '' && !startInFuture ? 'Pick a time in the future.' : null;

  const canSubmit = amountOk && whenOk && reason.trim().length >= REASON_MIN && !busy;

  const submit = async () => {
    if (!canSubmit || cents === null) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.setPrice({
        kind,
        amountUsdCents: cents,
        effectiveFrom: when === 'schedule' && start ? toIsoWithOffset(start) : null,
        reason: reason.trim(),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The price could not be saved');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      title="Change a price"
      description="Prices are in US dollars. A change applies only to transfers started, and re-issue requests made, after it takes effect."
    >
      <div className="space-y-1">
        <label htmlFor={kindId} className="block text-sm font-medium text-gray-200">Price</label>
        <select id={kindId} value={kind} onChange={(e) => setKind(e.target.value as PriceKind)} className={ADMIN_FIELD_CLASS}>
          {PRICE_KINDS.map((k) => (
            <option key={k} value={k}>{PRICE_LABEL[k]} (now {usd(current[k])})</option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor={amountId} className="block text-sm font-medium text-gray-200">New price (USD)</label>
        <input
          id={amountId}
          inputMode="decimal"
          autoComplete="off"
          placeholder="3.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-invalid={amountProblem ? true : undefined}
          aria-describedby={amountHintId}
          className={ADMIN_FIELD_CLASS}
        />
        <p id={amountHintId} className={`text-xs ${amountProblem ? 'text-red-400' : 'text-gray-400'}`}>
          {amountProblem ?? `From ${usd(PRICE_MIN_CENTS)} to ${usd(PRICE_MAX_CENTS)}.`}
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-gray-200">Takes effect</legend>
        <div className="flex gap-4">
          {(['now', 'schedule'] as const).map((w) => (
            <label key={w} className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
              <input
                type="radio"
                name="price-when"
                value={w}
                checked={when === w}
                onChange={() => setWhen(w)}
                className="accent-primary-500"
              />
              {w === 'now' ? 'Now' : 'Schedule'}
            </label>
          ))}
        </div>
        {when === 'schedule' && (
          <div className="space-y-1">
            <label htmlFor={startsId} className="block text-sm font-medium text-gray-200">
              Start date and time (your local time)
            </label>
            <input
              id={startsId}
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              aria-invalid={startProblem ? true : undefined}
              aria-describedby={startProblem ? startsHintId : undefined}
              className={ADMIN_FIELD_CLASS}
            />
            {startProblem && <p id={startsHintId} className="text-xs text-red-400">{startProblem}</p>}
          </div>
        )}
      </fieldset>

      <ReasonField value={reason} onChange={setReason} />

      {amountOk && whenOk && cents !== null && (
        <p className="text-sm text-gray-200" role="status">
          {PRICE_LABEL[kind]} changes from {usd(current[kind])} to {usd(cents)}{' '}
          {when === 'now' || !start ? 'now' : `on ${start.toLocaleString()}`}.
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
          {busy ? 'Saving…' : when === 'now' ? 'Set price' : 'Schedule price'}
        </button>
      </div>
    </AdminDialog>
  );
};

interface CancelPriceDialogProps {
  open: boolean;
  change: AdminPriceChange;
  currentCents: number;
  onClose: () => void;
  onDone: () => void;
}

export const AdminCancelPriceDialog = ({ open, change, currentCents, onClose, onDone }: CancelPriceDialogProps) => {
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
      await adminApi.cancelPrice(change.id, reason.trim());
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The change could not be cancelled');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      title="Cancel this scheduled change"
      description={
        `${PRICE_LABEL[change.kind]} will not change to ${usd(change.amountUsdCents)} on ${fmtDateTime(change.effectiveFrom)}. ` +
        `It stays at ${usd(currentCents)} unless another change is scheduled.`
      }
    >
      <ReasonField value={reason} onChange={setReason} />
      <ErrorLine message={error} />
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onClose} className={`${ADMIN_BUTTON_CLASS} bg-dark-700 text-gray-200 hover:bg-dark-600`}>
          Keep it
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy || reason.trim().length < REASON_MIN}
          className={`${ADMIN_BUTTON_CLASS} bg-red-600 hover:bg-red-500 text-white`}
        >
          {busy ? 'Working…' : 'Cancel the change'}
        </button>
      </div>
    </AdminDialog>
  );
};
