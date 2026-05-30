import { supabase } from './supabase';
import type { Settlement, AuctionSettlementSummary } from '@/features/auctions/types/settlement';
import type { Payout } from '@/features/payouts/types/payout';
import type { Verification, VerificationDetail } from '@/features/verification/types/verification';
import type { NfcTag, NfcTagDetail, ScanResult } from '@/features/verification/types/nfc';
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

  async confirmDelivery(settlementId: string): Promise<{
    settlementId: string;
    deliveryConfirmedAt: string;
    deliveryConfirmedBy: string;
    status: string;
  }> {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/delivery/${settlementId}/confirm-delivery`, {
      method: 'POST',
      headers,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error((error as { error?: string }).error || 'Failed to confirm delivery');
    }
    const json = await response.json();
    return json.data;
  },

  /**
   * Charge the buyer via the process-payment Supabase Edge Function.
   * The frontend tokenizes via Stripe Elements (returning a `pm_xxx`); the Edge Function
   * creates+confirms the PaymentIntent server-side with `automatic_payment_methods.allow_redirects: 'never'`.
   * On `payment_intent.succeeded`, the payment-webhook drives settlement → ESCROW_HOLD.
   */
  async processPayment(input: {
    amountCents: number;
    currency: string;
    paymentMethodId: string;
    listingId: string;
  }): Promise<{ success: true; transactionId: string; processor: string }> {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      throw new Error('Supabase config missing — cannot reach process-payment Edge Function');
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/process-payment`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: input.amountCents,
        currency: input.currency,
        paymentMethod: { type: 'CARD', paymentMethodId: input.paymentMethodId },
        metadata: { listingId: input.listingId },
      }),
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json.success) {
      const msg =
        (json as { error?: string; errorMessage?: string }).error ??
        (json as { errorMessage?: string }).errorMessage ??
        `Payment failed (${response.status})`;
      throw new Error(msg);
    }
    return json;
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

  // ── Module 13: NFC Verification (Session M) ──────────────────────────────

  /** Register an NTAG 424 DNA tag. */
  async nfcRegister(input: { tagUid: string; aesKey: string; itemId?: string }): Promise<NfcTag> {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/nfc/register`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error((error as { error?: string }).error || 'Failed to register NFC tag');
    }
    const json = await response.json();
    return json.data as NfcTag;
  },

  /** Scan an NFC tag (public, no auth). */
  async nfcScan(input: { sunMessage: string } | { piccData: string; cmac: string; tagUid: string }): Promise<ScanResult> {
    const response = await fetch(`${API_URL}/nfc/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error((error as { error?: string }).error || 'Scan failed');
    }
    const json = await response.json();
    return json.data as ScanResult;
  },

  /** Get presigned S3 URL for video proof upload. */
  async nfcUploadProof(input: { tagId: string; contentType: string; fileSize: number }): Promise<{ uploadUrl: string; publicUrl: string; videoKey: string }> {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/nfc/proof`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error((error as { error?: string }).error || 'Failed to get upload URL');
    }
    const json = await response.json();
    return json.data;
  },

  /** Get full tag verification data (public). */
  async nfcGetTag(tagId: string): Promise<NfcTagDetail> {
    const response = await fetch(`${API_URL}/nfc/${tagId}`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error((error as { error?: string }).error || 'NFC tag not found');
    }
    const json = await response.json();
    return json.data as NfcTagDetail;
  },

  /** Get full tag verification data by UID (public). */
  async nfcGetTagByUid(tagUid: string): Promise<NfcTagDetail> {
    const response = await fetch(`${API_URL}/nfc/by-uid/${tagUid}`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error((error as { error?: string }).error || 'NFC tag not found');
    }
    const json = await response.json();
    return json.data as NfcTagDetail;
  },

  /** Fetch all NFC tags for the authenticated seller. */
  async nfcGetTags(): Promise<NfcTag[]> {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/nfc/tags`, { headers });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error((error as { error?: string }).error || 'Failed to fetch tags');
    }
    const json = await response.json();
    return json.data as NfcTag[];
  },

  /** Transfer ownership of an NFC-tagged item. */
  async nfcTransfer(input: { tagId: string; toUserId: string; transferType: string; transactionId?: string }): Promise<void> {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/nfc/transfer`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error((error as { error?: string }).error || 'Failed to transfer ownership');
    }
  },

  /** Mint NFT for an NFC tag. */
  async nfcMint(tagId: string): Promise<{ txHash: string; tokenId: string; metadataUri: string; chain: string; contractAddress: string; ownerWallet: string }> {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/nfc/mint`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tagId }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error((error as { error?: string }).error || 'Minting failed');
    }
    const json = await response.json();
    return json.data;
  },

  // ── Phase 7D: Stripe Connect onboarding ──────────────────────────────────────

  stripeConnect: {
    /** Read the seller's current Connect onboarding state. */
    async getStatus(): Promise<StripeConnectStatus> {
      const headers = await getAuthHeader();
      const response = await fetch(`${API_URL}/stripe-connect/status`, { headers });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error((error as { error?: string }).error || 'Failed to fetch Connect status');
      }
      const json = await response.json();
      return json.data as StripeConnectStatus;
    },

    /** Create (or reuse) a Stripe Express account and return a fresh onboarding URL. */
    async createOnboardingLink(): Promise<{ url: string }> {
      const headers = await getAuthHeader();
      const response = await fetch(`${API_URL}/stripe-connect/onboarding-link`, {
        method: 'POST',
        headers,
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error((error as { error?: string }).error || 'Failed to start Stripe onboarding');
      }
      const json = await response.json();
      return json.data as { url: string };
    },
  },

  // ── Phase 7A (S22): Yoti identity verification ───────────────────────────────

  verification: {
    /**
     * Kick off a hosted Yoti session. The backend returns a URL we redirect
     * the user to. Truth lives in the webhook — this only seeds the session.
     */
    async startVerification(
      purpose: YotiVerificationPurpose,
      returnUrl?: string,
    ): Promise<YotiStartResult> {
      const headers = await getAuthHeader();
      const response = await fetch(`${API_URL}/verification/start`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose, return_url: returnUrl }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = (json as { error?: { code?: string; message?: string } }).error;
        const err = new Error(error?.message || 'Failed to start verification') as Error & { code?: string; status?: number };
        err.code = error?.code;
        err.status = response.status;
        throw err;
      }
      return (json as { data: YotiStartResult }).data;
    },

    /** Read the current user's verification facts + latest yoti_sessions row. */
    async getStatus(): Promise<YotiStatus> {
      const headers = await getAuthHeader();
      const response = await fetch(`${API_URL}/verification/status`, { headers });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error((error as { error?: { message?: string } }).error?.message || 'Failed to fetch verification status');
      }
      const json = await response.json();
      return (json as { data: YotiStatus }).data;
    },
  },
};

export interface StripeConnectStatus {
  status: 'not_started' | 'pending' | 'active' | 'restricted';
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  disabledReason: string | null;
  onboardingStartedAt: string | null;
}

// ── Phase 7A (S22): Yoti identity verification types ──────────────────────────

export type YotiVerificationPurpose = 'seller_kyc' | 'age_gate' | 'both';

export interface YotiStartResult {
  session_url: string;
  session_id: string;
}

export interface YotiSessionRow {
  id: string;
  yoti_session_id: string;
  purpose: string;
  status: string;
  age_estimate: number | null;
  rejection_reason: string | null;
  last_event_type: string | null;
  last_event_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Same enum as `verification_status` from database.types.ts, copied locally so
 * the seller-verification feature module doesn't need to import the giant
 * generated types file.
 */
export type YotiSellerStatus =
  | 'NONE'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'VIDEO_UPLOADED'
  | 'NFC_PROGRAMMED'
  | 'VERIFIED'
  | 'FLAGGED'
  | 'REVOKED';

export interface YotiStatus {
  seller_verification_status: YotiSellerStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  age_verified: boolean;
  age_verified_at: string | null;
  age_verification_provider: string | null;
  last_session: YotiSessionRow | null;
  feature_enabled: boolean;
}
