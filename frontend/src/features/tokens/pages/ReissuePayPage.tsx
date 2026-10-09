import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import type { StripeElementsOptions } from '@stripe/stripe-js';
import { Button } from '@/components/common/Button';
import { isStripeConfigured, isStripeTestMode, stripeAppearance, stripePromise } from '@/lib/stripe';
import { tokenApi, TokenApiError } from '../api/tokenApi';
import type { OwnerReissue, ReissuePay } from '../api/schemas';
import { formatMoney } from '../lib/copy';
import { REISSUE_STAGE_COPY, reissueReturnUrl, reissueStage } from '../lib/reissue';

const POLL_MS = 2000;
const POLL_LIMIT = 30;

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'missing' }
  | { kind: 'status'; request: OwnerReissue }
  | { kind: 'starting'; request: OwnerReissue }
  | { kind: 'paying'; request: OwnerReissue; charge: ReissuePay }
  | { kind: 'processing'; request: OwnerReissue; polls: number }
  | { kind: 'slow'; request: OwnerReissue };

/**
 * `/tokens/reissue/:requestId/pay` — pay the replacement fee on the website.
 *
 * The approval email links here. Payment is web only, never in the phone app
 * (Boss, 2026-10-09: app store fees). Stripe confirming the card is NOT
 * "paid": only the webhook marks the request PAID, so after confirming we poll
 * the request until it says so.
 */
export const ReissuePayPage = () => {
  const { requestId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const redirectStatus = searchParams.get('redirect_status');
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  const fetchRequest = useCallback(async (): Promise<OwnerReissue | null> => {
    const requests = await tokenApi.myReissueRequests();
    return requests.find((r) => r.id === requestId) ?? null;
  }, [requestId]);

  useEffect(() => {
    let cancelled = false;
    fetchRequest()
      .then((request) => {
        if (cancelled) return;
        if (!request) return setPhase({ kind: 'missing' });
        // Back from a redirect-based payment method: wait for the webhook.
        if (redirectStatus === 'succeeded' && reissueStage(request) === 'pay') {
          return setPhase({ kind: 'processing', request, polls: 0 });
        }
        setPhase({ kind: 'status', request });
      })
      .catch((err: unknown) => {
        if (!cancelled) setPhase({ kind: 'error', message: err instanceof Error ? err.message : 'Something went wrong.' });
      });
    return () => { cancelled = true; };
  }, [fetchRequest, redirectStatus]);

  // Poll until the webhook has marked it paid.
  useEffect(() => {
    if (phase.kind !== 'processing') return;
    const timer = setTimeout(() => {
      fetchRequest()
        .then((request) => {
          if (request && reissueStage(request) !== 'pay') return setPhase({ kind: 'status', request });
          setPhase((current) => {
            if (current.kind !== 'processing') return current;
            return current.polls + 1 >= POLL_LIMIT
              ? { kind: 'slow', request: current.request }
              : { ...current, polls: current.polls + 1 };
          });
        })
        .catch(() => setPhase((current) => (current.kind === 'processing' ? { kind: 'slow', request: current.request } : current)));
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [phase, fetchRequest]);

  const startPayment = async (request: OwnerReissue) => {
    setPhase({ kind: 'starting', request });
    try {
      const charge = await tokenApi.payReissue(request.id);
      setPhase({ kind: 'paying', request, charge });
    } catch (err) {
      setPhase({
        kind: 'error',
        message: err instanceof TokenApiError ? err.message : 'We could not start this payment. You have not been charged.',
      });
    }
  };

  const request = 'request' in phase ? phase.request : null;

  return (
    <main id="main-content" className="min-h-screen bg-dark-800 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <Link to={request ? `/tokens/${request.tagId}` : '/tokens'} className="text-sm text-gray-400 hover:text-white">
          <span aria-hidden="true">← </span>{request ? 'Back to the token' : 'My Tokens'}
        </Link>

        {phase.kind === 'loading' && (
          <div role="status" className="glass rounded-2xl p-8 text-center text-gray-300">Loading…</div>
        )}
        {phase.kind === 'error' && (
          <div role="alert" className="glass rounded-2xl p-8 text-center text-red-300">{phase.message}</div>
        )}
        {phase.kind === 'missing' && (
          <div className="glass rounded-2xl p-8 text-center">
            <h1 className="text-2xl font-bold text-white mb-2">Request not found.</h1>
            <p className="text-gray-400">Sign in with the account that asked for the replacement.</p>
          </div>
        )}

        {redirectStatus === 'failed' && phase.kind === 'status' && reissueStage(phase.request) === 'pay' && (
          <p role="alert" className="text-red-300 text-sm">Your payment did not go through. Please try again.</p>
        )}

        {request && (phase.kind === 'status' || phase.kind === 'starting') && (
          <section className="glass rounded-2xl p-8" aria-labelledby="reissue-pay-heading">
            <h1 id="reissue-pay-heading" className="text-2xl font-bold text-white mb-2">
              {REISSUE_STAGE_COPY[reissueStage(request)].title}
            </h1>
            <p className="text-gray-400 mb-5">{REISSUE_STAGE_COPY[reissueStage(request)].body}</p>
            {reissueStage(request) === 'pay' && (
              <>
                {request.chargedAmount !== null && request.chargedCurrency && (
                  <p className="text-gray-300 text-sm mb-4">
                    Replacement fee:{' '}
                    <span className="text-white font-semibold">{formatMoney(request.chargedAmount, request.chargedCurrency)}</span>
                  </p>
                )}
                <Button
                  onClick={() => startPayment(request)}
                  disabled={phase.kind === 'starting'}
                  aria-busy={phase.kind === 'starting'}
                >
                  {phase.kind === 'starting' ? 'Preparing payment…' : 'Continue to payment'}
                </Button>
              </>
            )}
          </section>
        )}

        {phase.kind === 'paying' && (
          <section className="glass rounded-2xl p-8" aria-labelledby="reissue-card-heading">
            <h1 id="reissue-card-heading" className="text-2xl font-bold text-white mb-4">Pay the replacement fee</h1>
            <PaymentStep
              charge={phase.charge}
              onPaid={() => setPhase({ kind: 'processing', request: phase.request, polls: 0 })}
            />
          </section>
        )}

        {phase.kind === 'processing' && (
          <div role="status" className="glass rounded-2xl p-8 text-center text-gray-300">
            Confirming your payment…
          </div>
        )}
        {phase.kind === 'slow' && (
          <section role="status" className="glass rounded-2xl p-8">
            <h1 className="text-2xl font-bold text-white mb-2">Your payment is being confirmed.</h1>
            <p className="text-gray-400">
              This is taking longer than usual. You will get an email when it is confirmed. You do not need to pay
              again.
            </p>
          </section>
        )}
      </div>
    </main>
  );
};

interface PaymentStepProps {
  readonly charge: ReissuePay;
  readonly onPaid: () => void;
}

const PaymentStep = ({ charge, onPaid }: PaymentStepProps) => {
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
      <PaymentForm charge={charge} onPaid={onPaid} />
    </Elements>
  );
};

const PaymentForm = ({ charge, onPaid }: PaymentStepProps) => {
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
        confirmParams: { return_url: reissueReturnUrl(charge.reissueRequestId) },
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
        Replacement fee: <span className="text-white font-semibold">{amount}</span>
      </p>
      <PaymentElement options={{ layout: 'tabs' }} />
      {error && (
        <p role="alert" className="text-red-300 text-sm">{error}</p>
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
