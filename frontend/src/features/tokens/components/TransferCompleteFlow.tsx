import { useEffect, useMemo, useRef, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import type { StripeElementsOptions } from '@stripe/stripe-js';
import { Link } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { isStripeConfigured, isStripeTestMode, stripeAppearance, stripePromise } from '@/lib/stripe';
import { tokenApi, TokenApiError } from '../api/tokenApi';
import type { TransferCompletePaid } from '../api/schemas';
import { formatMoney, transferErrorCopy } from '../lib/copy';
import { transferReturnUrl } from '../lib/transferReturn';
import { TransferProcessing } from './TransferProcessing';

interface TransferCompleteFlowProps {
  readonly transferId: string;
  readonly tagId: string;
  /** Tap session from the recipient's own tap; null when spent or expired. */
  readonly tapSession: string | null;
  readonly onSessionSpent: () => void;
  readonly onCompleted?: () => void;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'paying'; charge: TransferCompletePaid }
  /** A free transfer (voucher) was used: the server already completed it. No Stripe step. */
  | { kind: 'free' }
  | { kind: 'processing' }
  | { kind: 'error'; message: string };

/**
 * Recipient accepts a transfer: the tap that opened the page proves they hold
 * the item, then they pay the fee. The amount shown is what the server will
 * charge (`chargedAmount` / `chargedCurrency`), never a hard-coded price.
 *
 * S-ADMIN1 Ph3b: when the payer has a free transfer, the server uses it and
 * completes the transfer at once (`voucherApplied`). Stripe is never mounted.
 */
export const TransferCompleteFlow = ({ transferId, tagId, tapSession, onSessionSpent, onCompleted }: TransferCompleteFlowProps) => {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const start = async () => {
    if (!tapSession) return;
    setPhase({ kind: 'starting' });
    try {
      const charge = await tokenApi.completeTransfer(transferId, tapSession);
      onSessionSpent();
      setPhase(charge.voucherApplied ? { kind: 'free' } : { kind: 'paying', charge });
    } catch (err) {
      const apiError = err instanceof TokenApiError ? err : null;
      // Any answer from /complete has spent the session, success or not.
      if (apiError && apiError.status !== 0) onSessionSpent();
      setPhase({
        kind: 'error',
        message: apiError ? transferErrorCopy(apiError) : 'Something went wrong. Please try again.',
      });
    }
  };

  if (phase.kind === 'processing') {
    return <TransferProcessing transferId={transferId} tagId={tagId} onCompleted={onCompleted} />;
  }

  if (phase.kind === 'free') {
    return <FreeTransferDone tagId={tagId} onCompleted={onCompleted} />;
  }

  return (
    <section aria-labelledby="accept-heading" className="glass rounded-2xl p-6">
      <h2 id="accept-heading" className="text-lg font-semibold text-white mb-2">
        Accept this transfer
      </h2>

      {phase.kind === 'error' && (
        <p role="alert" className="text-red-300 text-sm">
          {phase.message}
        </p>
      )}

      {(phase.kind === 'idle' || phase.kind === 'starting') && !tapSession && (
        <p className="text-gray-400 text-sm">
          Your tap has expired. Tap the token again with your phone to accept.
        </p>
      )}

      {(phase.kind === 'idle' || phase.kind === 'starting') && tapSession && (
        <>
          <p className="text-gray-400 text-sm mb-2">
            The owner is transferring this token to you. Accept only if the item is in your hands.
          </p>
          <p className="text-gray-400 text-sm mb-5">
            You pay a small transfer fee. You will see the exact amount before you pay.
          </p>
          <Button onClick={start} disabled={phase.kind === 'starting'} aria-busy={phase.kind === 'starting'}>
            {phase.kind === 'starting' ? 'Preparing payment…' : 'Accept and continue to payment'}
          </Button>
        </>
      )}

      {phase.kind === 'paying' && (
        <PaymentStep
          charge={phase.charge}
          transferId={transferId}
          onPaid={() => setPhase({ kind: 'processing' })}
        />
      )}
    </section>
  );
};

const FreeTransferDone = ({ tagId, onCompleted }: { readonly tagId: string; readonly onCompleted?: () => void }) => {
  const onCompletedRef = useRef(onCompleted);
  useEffect(() => {
    onCompletedRef.current?.();
  }, []);
  return (
    <section className="glass rounded-2xl p-6" aria-live="polite">
      <h2 className="text-lg font-semibold text-white mb-2">It is yours.</h2>
      <p className="text-gray-400 text-sm mb-1">The transfer is complete and you are the owner on record.</p>
      <p className="text-gray-400 text-sm mb-3">You used a free transfer, so there was nothing to pay.</p>
      <Link to={`/tokens/${tagId}`} className="text-primary-300 underline hover:text-primary-200">
        View it in My Tokens
      </Link>
    </section>
  );
};

interface PaymentStepProps {
  readonly charge: TransferCompletePaid;
  readonly transferId: string;
  readonly onPaid: () => void;
}

const PaymentStep = ({ charge, transferId, onPaid }: PaymentStepProps) => {
  const options = useMemo<StripeElementsOptions>(
    () => ({ clientSecret: charge.clientSecret, appearance: stripeAppearance }),
    [charge.clientSecret],
  );
  if (!isStripeConfigured) {
    return (
      <p role="alert" className="text-red-300 text-sm">
        Payments are not available right now. Please try again later.
      </p>
    );
  }
  return (
    <Elements stripe={stripePromise} options={options}>
      <PaymentForm charge={charge} transferId={transferId} onPaid={onPaid} />
    </Elements>
  );
};

const PaymentForm = ({ charge, transferId, onPaid }: PaymentStepProps) => {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = formatMoney(charge.chargedAmount, charge.chargedCurrency);

  const pay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await stripe.confirmPayment({
        elements,
        redirect: 'if_required',
        confirmParams: { return_url: transferReturnUrl(transferId) },
      });
      if (result.error) {
        setError(result.error.message ?? 'Your payment did not go through. Please try again.');
        return;
      }
      onPaid();
    } catch {
      setError('Your payment did not go through. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={pay} className="space-y-4">
      <p className="text-gray-300 text-sm">
        Transfer fee: <span className="text-white font-semibold">{amount}</span>
      </p>
      <PaymentElement options={{ layout: 'tabs' }} />
      {error && (
        <p role="alert" className="text-red-300 text-sm">
          {error}
        </p>
      )}
      <Button type="submit" fullWidth disabled={!stripe || !elements || submitting} aria-busy={submitting}>
        {submitting ? 'Paying…' : `Pay ${amount}`}
      </Button>
      {isStripeTestMode && (
        <p className="text-xs text-gray-500 text-center">
          Test card: 4242 4242 4242 4242, any future expiry, any CVC, any ZIP
        </p>
      )}
    </form>
  );
};
