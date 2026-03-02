import { useState } from 'react';
import { api } from '@/lib/api';

export function usePlaceBid() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placeBid = async (auctionId: string, amountCents: number, maxBidCents?: number) => {
    try {
      setLoading(true);
      setError(null);
      const result = await api.placeBid(auctionId, amountCents, maxBidCents);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to place bid';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { placeBid, loading, error };
}
