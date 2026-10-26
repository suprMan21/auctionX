/**
 * S-ADMIN1 Ph3b price dialogs: set a price (now or scheduled) and cancel a
 * scheduled change. UX-2: opened from a price's card; an empty start date
 * means "starts now". Both need a typed reason for the audit log.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { adminApi } from '../api/adminApi';
import { type AdminPriceChange, type AdminPricing, type PriceKind } from '../api/pricingSchemas';
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
import { errorMessage } from '../lib/display';

interface SetPriceDialogProps {
  open: boolean;
  /** The price being changed: the dialog is opened from that price's card, so there is no picker. */
  kind: PriceKind;
  current: AdminPricing['current'];
  onClose: () => void;
  onDone: () => void;
}

export const AdminSetPriceDialog = ({ open, kind, current, onClose, onDone }: SetPriceDialogProps) => {
  const [amount, setAmount] = useState('');
  const [startsAt, setStartsAt] = useState('');
  // A half-typed datetime-local reads as '' — never let that pass as "starts now".
  const [startsIncomplete, setStartsIncomplete] = useState(false);
  const startsRef = useRef<HTMLInputElement>(null);
  // A half-typed field keeps value '' so no change event fires; read badInput on every keystroke and blur too.
  const syncStarts = () => {
    const el = startsRef.current;
    if (!el) return;
    setStartsAt(el.value);
    setStartsIncomplete(el.validity?.badInput ?? false);
  };
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountId = useId();
  const amountHintId = useId();
  const startsId = useId();
  const startsHintId = useId();

  useEffect(() => {
    if (open) {
      setAmount(''); setStartsAt(''); setStartsIncomplete(false); setReason(''); setError(null);
    }
  }, [open, kind]);

  const cents = parseDollarsToCents(amount);
  const amountOk = cents !== null && cents >= PRICE_MIN_CENTS && cents <= PRICE_MAX_CENTS;
  const amountProblem = amount.trim() !== '' && !amountOk
    ? `Enter an amount from ${usd(PRICE_MIN_CENTS)} to ${usd(PRICE_MAX_CENTS)}.`
    : null;

  // Empty start = starts now; a date = scheduled.
  const scheduled = startsAt !== '' || startsIncomplete;
  const start = startsAt !== '' ? parseLocalDateTime(startsAt) : null;
  // Checked at render time; the server rejects a start in the past anyway (no backdating).
  const startInFuture = start !== null && start.getTime() > Date.now();
  const whenOk = !scheduled || startInFuture;
  const startProblem = startsIncomplete
    ? 'Finish the date and time, or clear it to start now.'
    : scheduled && !startInFuture ? 'Pick a time in the future.' : null;

  const canSubmit = amountOk && whenOk && reason.trim().length >= REASON_MIN && !busy;
  const label = PRICE_LABEL[kind];

  const submit = async () => {
    if (!canSubmit || cents === null) return;
    // Last check at the moment of Confirm: a half-typed date must never become "starts now".
    if (startsRef.current?.validity?.badInput) {
      setStartsIncomplete(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminApi.setPrice({
        kind,
        amountUsdCents: cents,
        effectiveFrom: scheduled && start ? toIsoWithOffset(start) : null,
        reason: reason.trim(),
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err, 'The price could not be saved. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      title={`Change ${label.toLowerCase()}`}
      description={`Now ${usd(current[kind])}. Prices are in US dollars. A change applies only to transfers started, and re-issue requests made, after it takes effect.`}
    >
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

      <div className="space-y-1">
        <label htmlFor={startsId} className="block text-sm font-medium text-gray-200">
          Start date and time (optional, your local time)
        </label>
        <div className="flex gap-2">
          <input
            id={startsId}
            type="datetime-local"
            ref={startsRef}
            value={startsAt}
            onChange={syncStarts}
            onInput={syncStarts}
            onKeyUp={syncStarts}
            onBlur={syncStarts}
            aria-invalid={startProblem ? true : undefined}
            aria-describedby={startsHintId}
            className={ADMIN_FIELD_CLASS}
          />
          {scheduled && (
            <button
              type="button"
              onClick={() => {
                // Also clears half-typed date segments, which React state cannot see.
                if (startsRef.current) startsRef.current.value = '';
                setStartsAt('');
                setStartsIncomplete(false);
              }}
              className={`${ADMIN_BUTTON_CLASS} shrink-0 bg-dark-700 text-gray-200 hover:bg-dark-600`}
            >
              Clear
            </button>
          )}
        </div>
        <p id={startsHintId} className={`text-xs ${startProblem ? 'text-red-400' : 'text-gray-400'}`}>
          {startProblem ?? 'Leave empty to start now.'}
        </p>
      </div>

      <ReasonField value={reason} onChange={setReason} />

      <div className="text-sm text-gray-200 space-y-1" role="status">
        {amountOk && cents !== null && <p>{label} changes from {usd(current[kind])} to {usd(cents)}.</p>}
        {!startProblem && (
          <p className="font-semibold">
            {scheduled && start ? `Starts on ${fmtDateTime(start.toISOString())}.` : 'Starts now.'}
          </p>
        )}
      </div>

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
          {busy ? 'Saving…' : scheduled ? 'Schedule price' : 'Set price'}
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
      setError(errorMessage(err, 'The change could not be cancelled. Try again.'));
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
          Keep change
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy || reason.trim().length < REASON_MIN}
          className={`${ADMIN_BUTTON_CLASS} bg-red-600 hover:bg-red-500 text-white`}
        >
          {busy ? 'Cancelling…' : 'Cancel change'}
        </button>
      </div>
    </AdminDialog>
  );
};
