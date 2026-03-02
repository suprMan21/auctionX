import { useState } from 'react';
import { usePlaceBid } from '../hooks/usePlaceBid';
import { formatCurrency } from '../lib/formatCurrency';
import type { Database } from '@/types/database.types';

type Auction = Database['public']['Tables']['auctions']['Row'];

interface BidPlacementFormProps {
  auction: Auction;
  onSuccess?: () => void;
}

export function BidPlacementForm({ auction, onSuccess }: BidPlacementFormProps) {
  const { placeBid, loading, error } = usePlaceBid();
  const [bidAmount, setBidAmount] = useState('');
  const [maxBidAmount, setMaxBidAmount] = useState('');
  const [useProxyBid, setUseProxyBid] = useState(false);
  const [success, setSuccess] = useState(false);

  const minimumNextBid = auction.current_price_cents + auction.minimum_increment_cents;
  const minimumDollars = (minimumNextBid / 100).toFixed(2);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccess(false);

    const amountCents = Math.round(parseFloat(bidAmount) * 100);
    const maxBidCents = useProxyBid && maxBidAmount 
      ? Math.round(parseFloat(maxBidAmount) * 100) 
      : undefined;

    if (amountCents < minimumNextBid) {
      alert(`Bid must be at least ${formatCurrency(minimumNextBid, auction.currency)}`);
      return;
    }

    if (maxBidCents && maxBidCents < amountCents) {
      alert('Maximum bid must be greater than or equal to your bid amount');
      return;
    }

    try {
      await placeBid(auction.id, amountCents, maxBidCents);
      setSuccess(true);
      setBidAmount('');
      setMaxBidAmount('');
      setUseProxyBid(false);
      onSuccess?.();
    } catch (err) {
      console.error('Bid placement failed:', err);
    }
  };

  if (auction.status !== 'ACTIVE') {
    return (
      <div className="bg-gray-100 p-4 rounded text-gray-600">
        Bidding is not available for this auction
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="bidAmount" className="block text-sm font-medium text-gray-700 mb-1">
          Your Bid Amount
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
          <input
            type="text"
            inputMode="decimal"
            id="bidAmount"
            value={bidAmount}
            onChange={(e) => {
              const value = e.target.value.replace(/[^0-9.]/g, '');
              setBidAmount(value);
            }}
            className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder={minimumDollars}
            required
          />
        </div>
        <p className="text-xs text-gray-600 mt-1">
          Minimum: {formatCurrency(minimumNextBid, auction.currency)}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="useProxyBid"
          checked={useProxyBid}
          onChange={(e) => setUseProxyBid(e.target.checked)}
          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <label htmlFor="useProxyBid" className="text-sm text-gray-700">
          Use proxy bidding (auto-bid up to a maximum)
        </label>
      </div>

      {useProxyBid && (
        <div>
          <label htmlFor="maxBidAmount" className="block text-sm font-medium text-gray-700 mb-1">
            Maximum Bid Amount
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
            <input
              type="text"
              inputMode="decimal"
              id="maxBidAmount"
              value={maxBidAmount}
              onChange={(e) => {
                const value = e.target.value.replace(/[^0-9.]/g, '');
                setMaxBidAmount(value);
              }}
              className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder={minimumDollars}
              required={useProxyBid}
            />
          </div>
          <p className="text-xs text-gray-600 mt-1">
            The system will automatically bid on your behalf up to this amount
          </p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
          Bid placed successfully!
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? 'Placing Bid...' : 'Place Bid'}
      </button>
    </form>
  );
}
