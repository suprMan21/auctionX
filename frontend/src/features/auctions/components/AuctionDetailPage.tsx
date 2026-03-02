import { useParams, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuction } from '../hooks/useAuction';
import { CountdownTimer } from './CountdownTimer';
import { CurrentBidDisplay } from './CurrentBidDisplay';
import { BidHistory } from './BidHistory';
import { BidPlacementForm } from './BidPlacementForm';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { api } from '@/lib/api';
import type { AuctionSettlementSummary } from '@/features/auctions/types/settlement';

function SettlementBanner({
  summary,
  isWinner,
  isSeller,
}: {
  summary: AuctionSettlementSummary;
  isWinner: boolean;
  isSeller: boolean;
}) {
  if (isWinner) {
    return (
      <div className="mb-4 flex items-center justify-between bg-purple-900/40 border border-purple-500/30 rounded-2xl px-5 py-4 backdrop-blur">
        <div>
          <p className="text-purple-200 font-semibold">You won this auction!</p>
          <p className="text-purple-300/70 text-sm mt-0.5">Complete payment to secure your purchase.</p>
        </div>
        <Link
          to={`/settlements/${summary.settlementId}`}
          className="bg-gradient-to-r from-purple-600 to-blue-500 hover:from-purple-500 hover:to-blue-400 text-white text-sm font-semibold py-2 px-4 rounded-xl transition-all whitespace-nowrap"
        >
          Complete Payment →
        </Link>
      </div>
    );
  }

  if (isSeller) {
    return (
      <div className="mb-4 flex items-center justify-between bg-blue-900/40 border border-blue-500/30 rounded-2xl px-5 py-4 backdrop-blur">
        <div>
          <p className="text-blue-200 font-semibold">Auction ended — awaiting buyer payment.</p>
          <p className="text-blue-300/70 text-sm mt-0.5">View settlement details for status and payout info.</p>
        </div>
        <Link
          to={`/settlements/${summary.settlementId}`}
          className="bg-blue-700/60 hover:bg-blue-600/60 text-blue-100 text-sm font-semibold py-2 px-4 rounded-xl transition-all whitespace-nowrap border border-blue-500/30"
        >
          View Settlement →
        </Link>
      </div>
    );
  }

  return (
    <div className="mb-4 bg-gray-800/60 border border-gray-600/30 rounded-2xl px-5 py-3">
      <p className="text-gray-400 text-sm">This auction has ended.</p>
    </div>
  );
}

export function AuctionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { auction, loading, error } = useAuction(id!);
  const { user } = useAuth();
  const [settlementSummary, setSettlementSummary] = useState<AuctionSettlementSummary | null>(null);

  useEffect(() => {
    if (!id) return;
    api.getAuctionSettlement(id).then((summary) => {
      setSettlementSummary(summary);
    }).catch(() => {
      // Non-fatal — settlement banner is optional
    });
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl text-gray-600">Loading auction...</div>
      </div>
    );
  }

  if (error || !auction) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl text-red-600">
          {error || 'Auction not found'}
        </div>
      </div>
    );
  }

  const isSeller = user?.id === auction.seller_id;
  const showSettlementBanner =
    settlementSummary &&
    (auction.status === 'ENDED' || auction.status === 'SETTLED');
  const isWinner = !!user && settlementSummary?.buyerId === user.id;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          {showSettlementBanner && (
            <SettlementBanner
              summary={settlementSummary!}
              isWinner={isWinner}
              isSeller={isSeller}
            />
          )}
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div className="mb-4">
              <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
                auction.status === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                auction.status === 'ENDED' ? 'bg-gray-100 text-gray-800' :
                'bg-blue-100 text-blue-800'
              }`}>
                {auction.status}
              </span>
            </div>

            <h1 className="text-3xl font-bold mb-4">Auction #{auction.id.slice(0, 8)}</h1>

            {auction.status === 'ACTIVE' && (
              <div className="mb-6">
                <h2 className="text-sm font-medium text-gray-600 mb-2">Time Remaining</h2>
                <CountdownTimer endTime={auction.end_time} />
              </div>
            )}

            <CurrentBidDisplay auction={auction} />
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <BidHistory auctionId={auction.id} currency={auction.currency} />
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg shadow-md p-6 sticky top-4">
            <h2 className="text-xl font-bold mb-4">Place Your Bid</h2>
            
            {!user ? (
              <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded">
                Please log in to place a bid
              </div>
            ) : isSeller ? (
              <div className="bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded">
                You cannot bid on your own auction
              </div>
            ) : (
              <BidPlacementForm auction={auction} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
