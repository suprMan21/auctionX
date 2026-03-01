import { supabase } from './supabase';

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
};
