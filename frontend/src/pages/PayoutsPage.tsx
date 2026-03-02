import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/hooks/useAuth';
import type { Payout, PayoutStatus, PayoutSummary } from '@/features/payouts/types/payout';

function centsToDisplay(cents: number, currency = 'CAD'): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

function statusBadgeClass(status: PayoutStatus): string {
  const map: Record<PayoutStatus, string> = {
    PENDING:    'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
    PROCESSING: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    COMPLETED:  'bg-green-500/20 text-green-300 border-green-500/30',
    FAILED:     'bg-red-500/20 text-red-300 border-red-500/30',
    ON_HOLD:    'bg-gray-500/20 text-gray-300 border-gray-500/30',
  };
  return map[status] ?? 'bg-gray-500/20 text-gray-300 border-gray-500/30';
}

function PayoutRow({ payout }: { payout: Payout }) {
  const [expanded, setExpanded] = useState(false);
  const currency = payout.currency || 'CAD';
  const listingTitle =
    payout.settlement?.auctions?.listings?.title ??
    `Settlement ${payout.settlement_id.slice(0, 8)}`;

  const platformPct =
    payout.gross_amount_cents > 0
      ? ((payout.platform_fee_cents / payout.gross_amount_cents) * 100).toFixed(1)
      : '0.0';
  const processorPct =
    payout.gross_amount_cents > 0
      ? ((payout.processor_fee_cents / payout.gross_amount_cents) * 100).toFixed(1)
      : '0.0';

  return (
    <div className="glass rounded-2xl overflow-hidden">
      <button
        type="button"
        className="w-full text-left p-5 flex items-center justify-between hover:bg-white/5 transition-colors"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <div className="flex-1 min-w-0">
          <p className="text-white font-medium truncate">{listingTitle}</p>
          <p className="text-gray-400 text-sm mt-0.5">
            Eligible {new Date(payout.eligible_at).toLocaleDateString('en-CA')}
          </p>
        </div>
        <div className="flex items-center gap-4 ml-4 flex-shrink-0">
          <span className="text-green-400 font-bold text-lg">
            {centsToDisplay(payout.net_payout_cents, currency)}
          </span>
          <span
            className={`inline-block px-3 py-1 rounded-full text-xs font-semibold border ${statusBadgeClass(payout.status)}`}
          >
            {payout.status}
          </span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-5 w-5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-white/10 px-5 py-4 space-y-3">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Gross Amount</span>
              <span className="text-white">{centsToDisplay(payout.gross_amount_cents, currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Platform Fee ({platformPct}%)</span>
              <span className="text-red-400">− {centsToDisplay(payout.platform_fee_cents, currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Processor Fee ({processorPct}%)</span>
              <span className="text-red-400">− {centsToDisplay(payout.processor_fee_cents, currency)}</span>
            </div>
            <div className="flex justify-between border-t border-white/10 pt-2 font-semibold">
              <span className="text-white">Net Payout</span>
              <span className="text-green-400">{centsToDisplay(payout.net_payout_cents, currency)}</span>
            </div>
          </div>
          <div className="flex gap-4 text-sm pt-1">
            <Link
              to={`/settlements/${payout.settlement_id}`}
              className="text-purple-400 hover:text-purple-300 underline"
            >
              View Settlement →
            </Link>
            {payout.settlement?.auctions && (
              <Link
                to={`/auctions/${payout.settlement.auction_id}`}
                className="text-purple-400 hover:text-purple-300 underline"
              >
                View Auction →
              </Link>
            )}
          </div>
          {payout.failure_reason && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-red-300 text-sm">
              {payout.failure_reason}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function PayoutsPage() {
  const { user } = useAuth();
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    let mounted = true;

    async function fetchPayouts() {
      try {
        setLoading(true);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error: dbError } = await (supabase as any)
          .from('payouts')
          .select(
            '*, settlement:settlements(auction_id, auctions(listing_id, listings(title)))',
          )
          .eq('seller_id', user!.id)
          .order('created_at', { ascending: false });

        if (dbError) throw dbError;
        if (mounted) {
          setPayouts((data as unknown as Payout[]) ?? []);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load payouts');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchPayouts();
    return () => { mounted = false; };
  }, [user?.id]);

  const summary: PayoutSummary = {
    totalEarned: payouts
      .filter((p) => p.status === 'COMPLETED')
      .reduce((sum, p) => sum + p.net_payout_cents, 0),
    pendingEscrow: payouts
      .filter((p) => p.status === 'PENDING' || p.status === 'PROCESSING')
      .reduce((sum, p) => sum + p.net_payout_cents, 0),
    nextEligibleAt:
      payouts
        .filter((p) => p.status === 'PENDING')
        .sort((a, b) => a.eligible_at.localeCompare(b.eligible_at))[0]?.eligible_at ?? null,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-dark-800">
        <div className="text-gray-400">Loading payouts...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-dark-800">
        <div className="glass rounded-2xl p-8 text-center max-w-md">
          <p className="text-red-400 font-semibold">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-800 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-white">Payouts</h1>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="glass rounded-2xl p-5">
            <p className="text-gray-400 text-sm mb-1">Total Earned</p>
            <p className="text-2xl font-bold text-green-400">{centsToDisplay(summary.totalEarned)}</p>
          </div>
          <div className="glass rounded-2xl p-5">
            <p className="text-gray-400 text-sm mb-1">In Escrow / Processing</p>
            <p className="text-2xl font-bold text-blue-400">{centsToDisplay(summary.pendingEscrow)}</p>
          </div>
          <div className="glass rounded-2xl p-5">
            <p className="text-gray-400 text-sm mb-1">Next Payout Date</p>
            <p className="text-lg font-semibold text-white">
              {summary.nextEligibleAt
                ? new Date(summary.nextEligibleAt).toLocaleDateString('en-CA')
                : '—'}
            </p>
          </div>
        </div>

        {/* Payout list */}
        {payouts.length === 0 ? (
          <div className="glass rounded-2xl p-12 text-center">
            <p className="text-gray-400 text-lg">No payouts yet.</p>
            <p className="text-gray-500 text-sm mt-2">
              Payouts appear here after your auctions are settled and the 72-hour escrow window expires.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {payouts.map((payout) => (
              <PayoutRow key={payout.id} payout={payout} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
