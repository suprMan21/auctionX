import { supabase } from './supabase';
import type { Settlement, AuctionSettlementSummary } from '@/features/auctions/types/settlement';
import type { Payout } from '@/features/payouts/types/payout';
import type { Verification, VerificationDetail } from '@/features/verification/types/verification';
import type {
  ConversationWithDetails,
  Message,
  MessagesResponse,
  StartConversationResponse,
} from '@/features/messaging/types/messaging';
import type {
  NotificationPreferences,
  NotificationsResponse,
} from '@/features/notifications/types/notification';

// ── Module 14: Enhanced Search types ─────────────────────────────────────────

export interface SearchParams {
  q?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  condition?: string;
  verifiedOnly?: boolean;
  sort?: 'relevance' | 'ending_soonest' | 'price_asc' | 'price_desc' | 'newest';
  page?: number;
  limit?: number;
}

export interface SearchResult {
  id: string;
  title: string;
  condition: string;
  status: string;
  created_at: string;
  auctions: Array<{ id: string; current_price_cents: number; end_time: string; status: string }> | null;
  listing_media: Array<{ url: string; type: string; sort_order: number }> | null;
  item_verifications: Array<{ id: string; status: string; token_name: string }> | null;
  categories: Array<{ id: string; name: string; slug: string }> | null;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  page: number;
  totalPages: number;
}

export interface SavedSearchFilters {
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  condition?: string;
  verifiedOnly?: boolean;
  sort?: string;
}

export interface SavedSearch {
  id: string;
  user_id: string;
  name: string;
  query: string;
  filters: SavedSearchFilters;
  notify_new_results: boolean;
  last_checked_at: string | null;
  created_at: string;
}

export interface SavedSearchCreate {
  name: string;
  query: string;
  filters: SavedSearchFilters;
  notifyNewResults?: boolean;
}

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

  async createVerification(listingId: string): Promise<Verification> {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/verifications/create`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error((error as { error?: string }).error || 'Failed to create verification');
    }
    const json = await response.json();
    return json.data;
  },

  async getUploadUrl(verificationId: string, mimeType = 'video/webm'): Promise<{ uploadUrl: string; videoKey: string; publicUrl: string }> {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/verifications/${verificationId}/upload-url`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mimeType }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error((error as { error?: string }).error || 'Failed to get upload URL');
    }
    const json = await response.json();
    return json.data;
  },

  async confirmVideoUpload(verificationId: string, videoUrl: string, durationSeconds: number): Promise<Verification> {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/verifications/${verificationId}/upload-video`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl, durationSeconds }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error((error as { error?: string }).error || 'Failed to confirm video upload');
    }
    const json = await response.json();
    return json.data;
  },

  async registerNfc(verificationId: string, nfcTagUid: string): Promise<Verification> {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/verifications/${verificationId}/register-nfc`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ nfcTagUid }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error((error as { error?: string }).error || 'Failed to register NFC tag');
    }
    const json = await response.json();
    return json.data;
  },

  async getVerificationByToken(tokenName: string): Promise<VerificationDetail> {
    const response = await fetch(`${API_URL}/verify/${tokenName}`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error((error as { error?: string }).error || 'Verification not found');
    }
    const json = await response.json();
    return json.data;
  },

  async incrementScan(tokenName: string): Promise<void> {
    await fetch(`${API_URL}/verify/${tokenName}/scan`, { method: 'POST' }).catch(() => {
      // Non-fatal — scan count increment failure should not block page render
    });
  },

  // ── Module 14: Enhanced Search ──────────────────────────────────────────────

  /**
   * Search listings via full-text search and filters.
   * All params are optional; with no params returns latest ACTIVE listings.
   */
  async search(params: SearchParams = {}): Promise<SearchResponse> {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.category) qs.set('category', params.category);
    if (params.minPrice !== undefined) qs.set('minPrice', String(params.minPrice));
    if (params.maxPrice !== undefined) qs.set('maxPrice', String(params.maxPrice));
    if (params.condition) qs.set('condition', params.condition);
    if (params.verifiedOnly) qs.set('verifiedOnly', 'true');
    if (params.sort) qs.set('sort', params.sort);
    if (params.page !== undefined) qs.set('page', String(params.page));
    if (params.limit !== undefined) qs.set('limit', String(params.limit));

    const response = await fetch(`${API_URL}/search?${qs.toString()}`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error((error as { error?: string }).error || 'Search failed');
    }
    const json = await response.json();
    return json.data as SearchResponse;
  },

  /** Create a saved search for the authenticated user. */
  async createSavedSearch(data: SavedSearchCreate): Promise<SavedSearch> {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/search/saved`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error((error as { error?: string }).error || 'Failed to create saved search');
    }
    const json = await response.json();
    return json.data as SavedSearch;
  },

  /** Fetch all saved searches for the authenticated user. */
  async getSavedSearches(): Promise<SavedSearch[]> {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/search/saved`, { headers });
    if (!response.ok) throw new Error('Failed to fetch saved searches');
    const json = await response.json();
    return json.data as SavedSearch[];
  },

  /** Delete a saved search by ID (must be owned by the authenticated user). */
  async deleteSavedSearch(id: string): Promise<void> {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/search/saved/${id}`, {
      method: 'DELETE',
      headers,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error((error as { error?: string }).error || 'Failed to delete saved search');
    }
  },

  // ── Module 15: Messaging ────────────────────────────────────────────────────

  /** List all conversations for the authenticated user. */
  async getConversations(): Promise<ConversationWithDetails[]> {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/conversations`, { headers });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error((error as { error?: string }).error || 'Failed to fetch conversations');
    }
    const json = await response.json();
    return json.data as ConversationWithDetails[];
  },

  /** Fetch paginated messages for a conversation (also marks them as read server-side). */
  async getMessages(conversationId: string, page = 1, limit = 50): Promise<MessagesResponse> {
    const headers = await getAuthHeader();
    const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
    const response = await fetch(`${API_URL}/conversations/${conversationId}/messages?${qs}`, { headers });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error((error as { error?: string }).error || 'Failed to fetch messages');
    }
    const json = await response.json();
    return json.data as MessagesResponse;
  },

  /** Send a message in an existing conversation. */
  async sendMessage(conversationId: string, body: string): Promise<Message> {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error((error as { error?: string }).error || 'Failed to send message');
    }
    const json = await response.json();
    return json.data as Message;
  },

  /** Start a new conversation (or reuse existing) with an opening message. */
  async startConversation(
    listingId: string,
    recipientId: string,
    body: string,
  ): Promise<StartConversationResponse> {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/conversations/start`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId, recipientId, body }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error((error as { error?: string }).error || 'Failed to start conversation');
    }
    const json = await response.json();
    return json.data as StartConversationResponse;
  },

  // ── Module 16: Notifications ────────────────────────────────────────────────

  /** Fetch paginated notifications for the authenticated user. */
  async getNotifications(page = 1, unreadOnly = false): Promise<NotificationsResponse> {
    const headers = await getAuthHeader();
    const qs = new URLSearchParams({ page: String(page) });
    if (unreadOnly) qs.set('unread', 'true');
    const response = await fetch(`${API_URL}/notifications?${qs}`, { headers });
    if (!response.ok) throw new Error('Failed to fetch notifications');
    const json = await response.json();
    return json.data as NotificationsResponse;
  },

  /** Mark a single notification as read. */
  async markNotificationRead(id: string): Promise<void> {
    const headers = await getAuthHeader();
    await fetch(`${API_URL}/notifications/${id}/read`, { method: 'PATCH', headers });
  },

  /** Mark all unread notifications as read. */
  async markAllNotificationsRead(): Promise<void> {
    const headers = await getAuthHeader();
    await fetch(`${API_URL}/notifications/mark-all-read`, { method: 'POST', headers });
  },

  /** Fetch notification preferences for the authenticated user. */
  async getNotificationPreferences(): Promise<NotificationPreferences> {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/notifications/preferences`, { headers });
    if (!response.ok) throw new Error('Failed to fetch notification preferences');
    const json = await response.json();
    return json.data as NotificationPreferences;
  },

  /** Update notification preferences for the authenticated user. */
  async updateNotificationPreferences(
    prefs: Partial<Omit<NotificationPreferences, 'id' | 'user_id' | 'updated_at' | 'in_app_enabled'>>,
  ): Promise<NotificationPreferences> {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/notifications/preferences`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error((error as { error?: string }).error || 'Failed to update preferences');
    }
    const json = await response.json();
    return json.data as NotificationPreferences;
  },
};
