import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { CountdownTimer } from '@/features/auctions/components/CountdownTimer';
import type { Settlement } from '@/features/auctions/types/settlement';

function centsToDisplay(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PENDING_PAYMENT: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
    ESCROW_HOLD: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    COMPLETED: 'bg-green-500/20 text-green-300 border-green-500/30',
    CANCELLED: 'bg-red-500/20 text-red-300 border-red-500/30',
  };
  const cls = colors[status] ?? 'bg-gray-500/20 text-gray-300 border-gray-500/30';
  return (
    <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold border ${cls}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function BuyerView({ settlement }: { settlement: Settlement }) {
  const currency = settlement.auction?.currency ?? 'USD';
  const activeOffer = settlement.offers?.find((o) => o.status === 'PENDING_PAYMENT') ?? null;

  const SUPABASE_FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
    : null;

  const canPay = !!SUPABASE_FUNCTIONS_URL && settlement.status === 'PENDING_PAYMENT';

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
        {canPay ? (
          <div className="space-y-3">
            <button
              className="w-full bg-gradient-to-r from-purple-600 to-blue-500 hover:from-purple-500 hover:to-blue-400 text-white font-semibold py-3 px-6 rounded-xl transition-all"
              onClick={() => {
                // TODO: Initiate process-payment Edge Function call
                alert('Payment flow — connect to process-payment Edge Function when API keys are configured.');
              }}
            >
              Pay Now — {centsToDisplay(settlement.gross_amount_cents, currency)}
            </button>
            <p className="text-xs text-gray-500 text-center">
              Card payment window: 20 min · Crypto (if offered): 72 hrs
            </p>
          </div>
        ) : (
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 text-yellow-300 text-sm">
            Payment processing is not yet configured. Please contact support to complete your purchase.
          </div>
        )}
      </div>

      {settlement.status === 'ESCROW_HOLD' && (
        <div className="glass rounded-2xl p-6 border border-blue-500/20">
          <h2 className="text-lg font-semibold text-blue-300 mb-2">Payment Received</h2>
          <p className="text-gray-400 text-sm">
            Your payment is in escrow. The seller will ship your item shortly. Funds release once delivery is confirmed.
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
                <p className="text-xs text-gray-500 mb-2">Current window expires:</p>
                <CountdownTimer endTime={settlement.payment_window_expires_at} />
              </div>
            )}
          </div>
        ) : settlement.status === 'ESCROW_HOLD' ? (
          <p className="text-blue-300 text-sm">Payment received — awaiting delivery confirmation.</p>
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
          <BuyerView settlement={settlement} />
        ) : (
          <SellerView settlement={settlement} />
        )}
      </div>
    </div>
  );
}
