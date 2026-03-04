import { useBidHistory } from '../hooks/useBidHistory';
import { formatCurrency } from '../lib/formatCurrency';

interface BidHistoryProps {
  auctionId: string;
  currency: string;
}

export function BidHistory({ auctionId, currency }: BidHistoryProps) {
  const { bids, loading, error } = useBidHistory(auctionId);

  if (loading) {
    return <div className="text-gray-400">Loading bid history...</div>;
  }

  if (error) {
    return <div className="text-red-400">Error loading bids: {error}</div>;
  }

  if (bids.length === 0) {
    return <div className="text-gray-400">No bids yet. Be the first to bid!</div>;
  }

  return (
    <div className="space-y-2">
      <h3 className="font-semibold text-lg text-white mb-4">Bid History</h3>
      <div className="max-h-96 overflow-y-auto">
        {bids.map((bid) => (
          <div
            key={bid.id}
            className="flex justify-between items-center p-3 bg-white/5 rounded-xl hover:bg-white/10"
          >
            <div className="flex items-center gap-3">
              <div>
                <div className="font-medium text-white">
                  {formatCurrency(bid.amount_cents, currency)}
                </div>
                <div className="text-sm text-gray-400">
                  {new Date(bid.created_at).toLocaleString()}
                </div>
              </div>
              {bid.is_auto_bid && (
                <span className="text-xs bg-blue-900/30 text-blue-400 border border-blue-500/20 px-2 py-1 rounded">
                  Auto-bid
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
