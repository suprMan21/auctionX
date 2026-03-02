import { supabase } from './supabase';
import type { Settlement, AuctionSettlementSummary } from '@/features/auctions/types/settlement';
import type { Payout } from '@/features/payouts/types/payout';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

async function getAuthHeader() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Not authenticated');
  }
  return { Authorization: `Bearer ${session.access_token}` };
}

export const api = {
  async getAuction(auctionId: string) {
    const response = await fetch(`${API_URL}/auctions/${auctionId}`);
    if (!response.ok) throw new Error('Failed to fetch auction');
    return response.json();
  },

  async getBidHistory(auctionId: string) {
    const response = await fetch(`${API_URL}/auctions/${auctionId}/bids`);
    if (!response.ok) throw new Error('Failed to fetch bids');
    return response.json();
  },

  async placeBid(auctionId: string, amountCents: number, maxBidCents?: number) {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/auctions/${auctionId}/bids`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ auctionId, amountCents, maxBidCents }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to place bid');
    }
    return response.json();
  },

  async getSettlement(settlementId: string): Promise<Settlement> {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/settlements/${settlementId}`, { headers });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to fetch settlement');
    }
    const json = await response.json();
    return json.data;
  },

  async getAuctionSettlement(auctionId: string): Promise<AuctionSettlementSummary | null> {
    const response = await fetch(`${API_URL}/auctions/${auctionId}/settlement`);
    if (response.status === 404) return null;
    if (!response.ok) return null;
    const json = await response.json();
    return json.data;
  },

  async getPayouts(): Promise<Payout[]> {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/payouts`, { headers });
    if (!response.ok) throw new Error('Failed to fetch payouts');
    const json = await response.json();
    return json.data;
  },

  async openDispute(settlementId: string, reason: string): Promise<void> {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/settlements/${settlementId}/dispute`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error((error as { error?: string }).error || 'Failed to open dispute');
    }
  },
};
