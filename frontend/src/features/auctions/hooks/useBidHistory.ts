import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/api';
import type { Database } from '@/types/database.types';

type Bid = Database['public']['Tables']['bids']['Row'];

export function useBidHistory(auctionId: string) {
  const [bids, setBids] = useState<Bid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchBids() {
      try {
        setLoading(true);
        const data = await api.getBidHistory(auctionId);
        if (mounted) {
          setBids(data);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load bids');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    fetchBids();

    const channel = supabase
      .channel(`bids:${auctionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'bids',
          filter: `auction_id=eq.${auctionId}`,
        },
        (payload) => {
          if (mounted) {
            setBids((prev) => [payload.new as Bid, ...prev]);
          }
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      channel.unsubscribe();
    };
  }, [auctionId]);

  return { bids, loading, error };
}
