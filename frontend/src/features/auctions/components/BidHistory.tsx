import { useBidHistory } from '../hooks/useBidHistory';
import { formatCurrency } from '../lib/formatCurrency';

interface BidHistoryProps {
  auctionId: string;
  currency: string;
}

export function BidHistory({ auctionId, currency }: BidHistoryProps) {
  const { bids, loading, error } = useBidHistory(auctionId);

  if (loading) {
    return <div className="text-gray-600">Loading bid history...</div>;
  }

  if (error) {
    return <div className="text-red-600">Error loading bids: {error}</div>;
  }

  if (bids.length === 0) {
    return <div className="text-gray-600">No bids yet. Be the first to bid!</div>;
  }

  return (
    <div className="space-y-2">
      <h3 className="font-semibold text-lg mb-4">Bid History</h3>
      <div className="max-h-96 overflow-y-auto">
        {bids.map((bid) => (
          <div
            key={bid.id}
            className="flex justify-between items-center p-3 bg-gray-50 rounded hover:bg-gray-100"
          >
            <div className="flex items-center gap-3">
              <div>
                <div className="font-medium">
                  {formatCurrency(bid.amount_cents, currency)}
                </div>
                <div className="text-sm text-gray-600">
                  {new Date(bid.created_at).toLocaleString()}
                </div>
              </div>
              {bid.is_auto_bid && (
                <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
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
