import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { CountdownTimer } from '@/features/auctions/components/CountdownTimer';
import { Modal } from '@/components/common/Modal';
import { PaymentForm } from '@/components/PaymentForm';
import { DisputeSubmissionForm } from '@/components/disputes/DisputeSubmissionForm';
import type { Settlement } from '@/features/auctions/types/settlement';
import toast from 'react-hot-toast';

function centsToDisplay(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PENDING_PAYMENT: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
    ESCROW_HOLD:     'bg-blue-500/20 text-blue-300 border-blue-500/30',
    COMPLETED:       'bg-green-500/20 text-green-300 border-green-500/30',
    CANCELLED:       'bg-red-500/20 text-red-300 border-red-500/30',
    RELEASED:        'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    DISPUTED:        'bg-orange-500/20 text-orange-300 border-orange-500/30',
  };
  const cls = colors[status] ?? 'bg-gray-500/20 text-gray-300 border-gray-500/30';
  return (
    <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold border ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function BuyerView({
  settlement,
  onDisputeOpened,
  onDeliveryConfirmed,
}: {
  settlement: Settlement;
  onDisputeOpened: () => void;
  onDeliveryConfirmed: (confirmedAt: string, confirmedBy: string) => void;
}) {
  const currency = settlement.auction?.currency ?? 'USD';
  const activeOffer = settlement.offers?.find((o) => o.status === 'PENDING_PAYMENT') ?? null;
  const [confirmingDelivery, setConfirmingDelivery] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [appealReason, setAppealReason] = useState('');
  const [appealSubmitting, setAppealSubmitting] = useState(false);

  const hasPaymentConfig =
    !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
  const listingId = settlement.auction?.listing_id ?? null;
  const canPay =
    hasPaymentConfig && settlement.status === 'PENDING_PAYMENT' && !!listingId;
  const deliveryConfirmed = !!settlement.delivery_confirmed_at;

  // Appeal eligibility: a rejected dispute that's still inside the 7-day window.
  // We render the appeal block when the resolution was REJECTED, status returned
  // to ESCROW_HOLD, and the deadline hasn't lapsed. (S25.5 will replace this with
  // a richer appeal UI; this is the minimum viable surfacing for the buyer.)
  const appealDeadline = (settlement as Settlement & { appeal_deadline?: string | null })
    .appeal_deadline;
  const resolutionAction = (settlement as Settlement & { resolution_action?: string | null })
    .resolution_action;
  const canAppeal =
    resolutionAction === 'REJECTED' &&
    settlement.status === 'ESCROW_HOLD' &&
    appealDeadline !== null &&
    appealDeadline !== undefined &&
    new Date(appealDeadline) > new Date();

  const handleOpenAppeal = async () => {
    if (appealReason.trim().length < 20) {
      toast.error('Please provide at least 20 characters for your appeal.');
      return;
    }
    setAppealSubmitting(true);
    try {
      await api.openDisputeAppeal(settlement.id, appealReason.trim());
      toast.success('Appeal submitted. Our team will re-review your case.');
      onDisputeOpened();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to open appeal');
    } finally {
      setAppealSubmitting(false);
    }
  };

  const handleConfirmDelivery = async () => {
    const ok = window.confirm(
      'Confirm delivery? This releases the escrowed funds to the seller within ~15 minutes. Only do this after you have received and inspected your item.',
    );
    if (!ok) return;
    setConfirmingDelivery(true);
    try {
      const result = await api.confirmDelivery(settlement.id);
      onDeliveryConfirmed(result.deliveryConfirmedAt, result.deliveryConfirmedBy);
      toast.success('Delivery confirmed — funds will release within 15 minutes.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to confirm delivery');
    } finally {
      setConfirmingDelivery(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="glass rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Your Win</h2>
        <div className="flex items-center justify-between mb-2">
          <span className="text-gray-400">Amount Due</span>
          <span className="text-2xl font-bold text-white">
            {centsToDisplay(settlement.gross_amount_cents, currency)}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400">Auction</span>
          <Link
            to={`/auctions/${settlement.auction_id}`}
            className="text-purple-400 hover:text-purple-300 underline"
          >
            #{settlement.auction_id.slice(0, 8)}
          </Link>
        </div>
      </div>

      {settlement.status === 'PENDING_PAYMENT' && activeOffer && (
        <div className="glass rounded-2xl p-6 border border-yellow-500/20">
          <h2 className="text-lg font-semibold text-yellow-300 mb-3">Payment Window</h2>
          <p className="text-sm text-gray-400 mb-4">
            Complete payment within 20 minutes to secure your purchase. Non-payment will result in an account penalty.
          </p>
          <CountdownTimer endTime={activeOffer.payment_window_expires_at} />
        </div>
      )}

      <div className="glass rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Payment</h2>
        {canPay && listingId ? (
          <div className="space-y-3">
            <button
              className="w-full bg-gradient-to-r from-purple-600 to-blue-500 hover:from-purple-500 hover:to-blue-400 text-white font-semibold py-3 px-6 rounded-xl transition-all"
              onClick={() => setPaymentOpen(true)}
            >
              Pay Now — {centsToDisplay(settlement.gross_amount_cents, currency)}
            </button>
            <p className="text-xs text-gray-400 text-center">
              Card payment window: 20 min · Crypto (if offered): 72 hrs
            </p>
          </div>
        ) : (
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 text-yellow-300 text-sm">
            Payment processing is not yet configured. Please contact support to complete your purchase.
          </div>
        )}
      </div>

      {canPay && listingId && (
        <Modal
          isOpen={paymentOpen}
          onClose={() => setPaymentOpen(false)}
          title={`Pay ${centsToDisplay(settlement.gross_amount_cents, currency)}`}
        >
          <PaymentForm
            amountCents={settlement.gross_amount_cents}
            currency={currency}
            listingId={listingId}
            onSuccess={() => {
              setPaymentOpen(false);
              toast.success('Payment received — awaiting escrow confirmation.');
              // Realtime subscription on settlements table will push the
              // PENDING_PAYMENT → ESCROW_HOLD transition once the Stripe webhook fires.
            }}
            onCancel={() => setPaymentOpen(false)}
          />
        </Modal>
      )}

      {settlement.status === 'ESCROW_HOLD' && (
        <>
          <div className="glass rounded-2xl p-6 border border-blue-500/20">
            <h2 className="text-lg font-semibold text-blue-300 mb-2">Payment Received</h2>
            <p className="text-gray-400 text-sm">
              Your payment is in escrow. The seller will ship your item shortly. Funds release once delivery is confirmed.
            </p>
          </div>

          {deliveryConfirmed ? (
            <div className="glass rounded-2xl p-6 border border-emerald-500/20">
              <h2 className="text-lg font-semibold text-emerald-300 mb-2">Delivery Confirmed</h2>
              <p className="text-gray-400 text-sm">
                Thanks — you confirmed delivery on{' '}
                {new Date(settlement.delivery_confirmed_at!).toLocaleString()}. Funds will release to the seller within ~15 minutes.
              </p>
            </div>
          ) : (
            <div className="glass rounded-2xl p-6 border border-emerald-500/20">
              <h2 className="text-lg font-semibold text-emerald-300 mb-2">Confirm Delivery</h2>
              <p className="text-gray-400 text-sm mb-4">
                Received your item and happy with it? Confirm delivery to release the funds to the seller immediately
                (otherwise escrow auto-releases at the end of the hold window).
              </p>
              <button
                type="button"
                onClick={handleConfirmDelivery}
                disabled={confirmingDelivery}
                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed
                           text-white font-semibold py-3 px-6 rounded-xl transition-all"
              >
                {confirmingDelivery ? 'Confirming…' : 'Confirm Delivery'}
              </button>
            </div>
          )}

          {!deliveryConfirmed && !canAppeal && (
            <DisputeSubmissionForm
              settlementId={settlement.id}
              onSubmitted={onDisputeOpened}
            />
          )}

          {canAppeal && (
            <div className="glass rounded-2xl p-6 border border-orange-500/20">
              <h2 className="text-lg font-semibold text-orange-300 mb-3">Appeal Available</h2>
              <p className="text-gray-400 text-sm mb-2">
                Your dispute was decided in the seller's favor. You can appeal until{' '}
                <strong className="text-white">
                  {appealDeadline ? new Date(appealDeadline).toLocaleString() : '—'}
                </strong>.
              </p>
              <label htmlFor="appeal-reason" className="block text-sm text-gray-300 mb-2">
                Why should we re-review? <span className="text-gray-400">(min. 20 characters)</span>
              </label>
              <textarea
                id="appeal-reason"
                rows={4}
                value={appealReason}
                onChange={(e) => setAppealReason(e.target.value)}
                placeholder="Provide any additional context or evidence that wasn't captured the first time."
                className="w-full rounded-xl bg-white/5 border border-white/10 text-white text-sm px-3 py-2
                           placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
              />
              <p className="text-xs text-gray-400 mt-1 mb-3">{appealReason.trim().length} / 20 minimum</p>
              <button
                type="button"
                onClick={handleOpenAppeal}
                disabled={appealSubmitting || appealReason.trim().length < 20}
                className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed
                           text-white font-semibold py-3 px-6 rounded-xl transition-all"
              >
                {appealSubmitting ? 'Submitting…' : 'Submit Appeal'}
              </button>
            </div>
          )}
        </>
      )}

      {settlement.status === 'DISPUTED' && (
        <div className="glass rounded-2xl p-6 border border-orange-500/20">
          <h2 className="text-lg font-semibold text-orange-300 mb-2">Dispute Under Review</h2>
          <p className="text-gray-400 text-sm">
            Your dispute has been submitted and is being reviewed by our team. We will contact you with a resolution.
          </p>
        </div>
      )}

      {settlement.status === 'RELEASED' && (
        <div className="glass rounded-2xl p-6 border border-emerald-500/20">
          <h2 className="text-lg font-semibold text-emerald-300 mb-2">Escrow Released</h2>
          <p className="text-gray-400 text-sm">
            The escrow hold has ended and funds have been released to the seller.
          </p>
        </div>
      )}

      {settlement.status === 'COMPLETED' && (
        <div className="glass rounded-2xl p-6 border border-green-500/20">
          <h2 className="text-lg font-semibold text-green-300 mb-2">Transaction Complete</h2>
          <p className="text-gray-400 text-sm">Your purchase is complete. Enjoy your item!</p>
        </div>
      )}

      {settlement.status === 'CANCELLED' && (
        <div className="glass rounded-2xl p-6 border border-red-500/20">
          <h2 className="text-lg font-semibold text-red-300 mb-2">Settlement Cancelled</h2>
          <p className="text-gray-400 text-sm">
            This settlement was cancelled. No payment was collected.
          </p>
        </div>
      )}
    </div>
  );
}

function SellerView({ settlement }: { settlement: Settlement }) {
  const currency = settlement.auction?.currency ?? 'USD';

  return (
    <div className="space-y-6">
      <div className="glass rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Settlement Summary</h2>

        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-gray-400">Gross Amount</span>
            <span className="text-white font-medium">
              {centsToDisplay(settlement.gross_amount_cents, currency)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Platform Fee ({settlement.platform_fee_percent}%)</span>
            <span className="text-red-400">
              − {centsToDisplay(settlement.platform_fee_cents, currency)}
            </span>
          </div>
          {settlement.processor_fee_cents > 0 && (
            <div className="flex justify-between">
              <span className="text-gray-400">Processor Fee ({settlement.processor_fee_percent}%)</span>
              <span className="text-red-400">
                − {centsToDisplay(settlement.processor_fee_cents, currency)}
              </span>
            </div>
          )}
          <div className="border-t border-white/10 pt-3 flex justify-between">
            <span className="text-white font-semibold">Your Payout</span>
            <span className="text-green-400 font-bold text-xl">
              {centsToDisplay(settlement.net_amount_cents, currency)}
            </span>
          </div>
        </div>
      </div>

      <div className="glass rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-white mb-3">Buyer Status</h2>
        {settlement.status === 'PENDING_PAYMENT' ? (
          <div className="space-y-2">
            <p className="text-yellow-300 text-sm">Awaiting buyer payment.</p>
            {settlement.offer_attempt > 1 && (
              <p className="text-gray-400 text-xs">
                Offer attempt {settlement.offer_attempt} — previous buyer(s) did not pay.
              </p>
            )}
            {settlement.payment_window_expires_at && (
              <div className="mt-3">
                <p className="text-xs text-gray-400 mb-2">Current window expires:</p>
                <CountdownTimer endTime={settlement.payment_window_expires_at} />
              </div>
            )}
          </div>
        ) : settlement.status === 'ESCROW_HOLD' ? (
          <p className="text-blue-300 text-sm">Payment received — awaiting delivery confirmation.</p>
        ) : settlement.status === 'DISPUTED' ? (
          <div className="space-y-2">
            <p className="text-orange-300 text-sm font-semibold">The buyer has opened a dispute.</p>
            {settlement.dispute_reason && (
              <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-3 text-orange-200 text-sm">
                {settlement.dispute_reason}
              </div>
            )}
            <p className="text-gray-400 text-xs">An admin will review and resolve the dispute.</p>
          </div>
        ) : settlement.status === 'RELEASED' ? (
          <p className="text-emerald-300 text-sm">Escrow released — payout is being processed.</p>
        ) : settlement.status === 'COMPLETED' ? (
          <p className="text-green-300 text-sm">Payout complete.</p>
        ) : (
          <p className="text-red-300 text-sm">
            Settlement cancelled — no eligible buyers completed payment. You may relist your item.
          </p>
        )}
      </div>

      <div className="glass rounded-2xl p-6">
        <Link
          to={`/auctions/${settlement.auction_id}`}
          className="text-purple-400 hover:text-purple-300 text-sm underline"
        >
          View Auction →
        </Link>
      </div>
    </div>
  );
}

export function SettlementPage() {
  const { settlementId } = useParams<{ settlementId: string }>();
  const { user } = useAuth();
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settlementId) return;

    let mounted = true;

    async function fetchSettlement() {
      try {
        setLoading(true);
        const data = await api.getSettlement(settlementId!);
        if (mounted) {
          setSettlement(data);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load settlement');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchSettlement();

    // Realtime subscription on settlement status changes
    const channel = supabase
      .channel(`settlement:${settlementId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'settlements',
          filter: `id=eq.${settlementId}`,
        },
        (payload) => {
          if (mounted) {
            setSettlement((prev) => prev ? { ...prev, ...(payload.new as Partial<Settlement>) } : null);
          }
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      channel.unsubscribe();
    };
  }, [settlementId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-dark-800">
        <div className="text-gray-400">Loading settlement...</div>
      </div>
    );
  }

  if (error || !settlement) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-dark-800">
        <div className="glass rounded-2xl p-8 text-center max-w-md">
          <p className="text-red-400 font-semibold">{error || 'Settlement not found'}</p>
          <Link to="/" className="mt-4 inline-block text-purple-400 hover:text-purple-300 text-sm underline">
            Return home
          </Link>
        </div>
      </div>
    );
  }

  const role = settlement.role ?? (user?.id === settlement.seller_id ? 'seller' : 'buyer');

  return (
    <div className="min-h-screen bg-dark-800 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Settlement</h1>
            <p className="text-gray-400 text-sm mt-1">#{settlementId?.slice(0, 8)}</p>
          </div>
          <StatusBadge status={settlement.status} />
        </div>

        {role === 'buyer' ? (
          <BuyerView
            settlement={settlement}
            onDisputeOpened={() =>
              setSettlement((prev) => prev ? { ...prev, status: 'DISPUTED' as const } : null)
            }
            onDeliveryConfirmed={(confirmedAt, confirmedBy) =>
              setSettlement((prev) =>
                prev
                  ? { ...prev, delivery_confirmed_at: confirmedAt, delivery_confirmed_by: confirmedBy }
                  : null,
              )
            }
          />
        ) : (
          <SellerView settlement={settlement} />
        )}
      </div>
    </div>
  );
}
