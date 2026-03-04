import { formatCurrency } from '../lib/formatCurrency';
import type { Database } from '@/types/database.types';

type Auction = Database['public']['Tables']['auctions']['Row'];

interface CurrentBidDisplayProps {
  auction: Auction;
}

export function CurrentBidDisplay({ auction }: CurrentBidDisplayProps) {
  const minimumNextBid = auction.current_price_cents + auction.minimum_increment_cents;

  return (
    <div className="bg-dark-700/60 border border-white/5 rounded-2xl p-6">
      <div className="mb-4">
        <div className="text-sm text-gray-400">Current Bid</div>
        <div data-testid="current-bid" className="text-3xl font-bold text-white">
          {formatCurrency(auction.current_price_cents, auction.currency)}
        </div>
      </div>

      <div className="mb-4">
        <div className="text-sm text-gray-400">Minimum Next Bid</div>
        <div className="text-xl font-semibold text-gray-200">
          {formatCurrency(minimumNextBid, auction.currency)}
        </div>
      </div>

      {auction.reserve_price_cents && (
        <div className="text-sm text-gray-400">
          {auction.current_price_cents >= auction.reserve_price_cents ? (
            <span className="text-green-400">✓ Reserve met</span>
          ) : (
            <span className="text-amber-400">Reserve not met</span>
          )}
        </div>
      )}
    </div>
  );
}
