import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/api';
import type { Database } from '@/types/database.types';

type Auction = Database['public']['Tables']['auctions']['Row'];

export function useAuction(auctionId: string) {
  const [auction, setAuction] = useState<Auction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchAuction() {
      try {
        setLoading(true);
        const data = await api.getAuction(auctionId);
        if (mounted) {
          setAuction(data);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load auction');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    fetchAuction();

    const channel = supabase
      .channel(`auction:${auctionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'auctions',
          filter: `id=eq.${auctionId}`,
        },
        (payload) => {
          if (mounted) {
            setAuction(payload.new as Auction);
          }
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      channel.unsubscribe();
    };
  }, [auctionId]);

  return { auction, loading, error };
}
