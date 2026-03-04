import { useListingCreation } from '../../../stores/listingCreationStore';
import { useAuth } from '../../../features/auth/hooks/useAuth';

const TIER_FEES = {
  TIER_1: 0.20,
  TIER_2: 0.175,
  TIER_3: 0.15,
};

export function PricingStep() {
  const { draft, setReservePrice, setCurrency } = useListingCreation();
  const { user } = useAuth();

  const reservePriceDollars = draft.reserve_price_cents / 100;
  const sellerTier = (user?.user_metadata?.seller_tier || 'TIER_1') as keyof typeof TIER_FEES;
  const platformFeePercent = TIER_FEES[sellerTier] * 100;
  const estimatedFee = draft.reserve_price_cents * TIER_FEES[sellerTier];

  const handlePriceChange = (value: string) => {
    const dollars = parseFloat(value) || 0;
    setReservePrice(Math.round(dollars * 100));
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium text-white mb-2">Set Your Price</h2>
        <p className="text-sm text-gray-400">
          Set a reserve price for your auction. The auction won't sell below this price.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="currency" className="block text-sm font-medium text-gray-300 mb-1.5">
            Currency
          </label>
          <select
            id="currency"
            value={draft.currency}
            onChange={(e) => setCurrency(e.target.value as 'CAD' | 'USD')}
            className="w-full bg-dark-600 text-white border border-transparent rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
          >
            <option value="CAD">CAD - Canadian Dollar</option>
            <option value="USD">USD - US Dollar</option>
          </select>
        </div>

        <div>
          <label htmlFor="reserve-price" className="block text-sm font-medium text-gray-300 mb-1.5">
            Reserve Price
          </label>
          <div className="relative">
            <span className="absolute left-3 top-3 text-gray-400">$</span>
            <input
              type="number"
              id="reserve-price"
              value={reservePriceDollars}
              onChange={(e) => handlePriceChange(e.target.value)}
              min="0"
              step="0.01"
              className="w-full pl-8 pr-3 bg-dark-600 text-white border border-transparent rounded-xl py-3 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
              placeholder="0.00"
            />
          </div>
        </div>
      </div>

      <div className="glass rounded-2xl p-4 space-y-2">
        <h3 className="text-sm font-medium text-white">Fee Breakdown</h3>
        <div className="text-sm text-gray-400 space-y-1">
          <div className="flex justify-between">
            <span>Your Tier:</span>
            <span className="font-medium">{sellerTier}</span>
          </div>
          <div className="flex justify-between">
            <span>Platform Fee:</span>
            <span className="font-medium">{platformFeePercent}%</span>
          </div>
          {draft.reserve_price_cents > 0 && (
            <>
              <div className="flex justify-between border-t border-white/10 pt-1">
                <span>Reserve Price:</span>
                <span className="font-medium">
                  ${reservePriceDollars.toFixed(2)} {draft.currency}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Estimated Fee:</span>
                <span className="font-medium text-error-400">
                  -${(estimatedFee / 100).toFixed(2)} {draft.currency}
                </span>
              </div>
              <div className="flex justify-between border-t border-white/10 pt-1 font-semibold">
                <span>You Receive:</span>
                <span className="text-success-400">
                  ${((draft.reserve_price_cents - estimatedFee) / 100).toFixed(2)} {draft.currency}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="glass border border-primary-500/30 rounded-xl p-4">
        <p className="text-sm text-primary-300">
          <strong>Note:</strong> Your current seller tier is {sellerTier}. Earn {sellerTier === 'TIER_1' ? '$10,000' : '$100,000'} in the next 12 months to upgrade and reduce your fees.
        </p>
      </div>
    </div>
  );
}
