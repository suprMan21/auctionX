/**
 * TypeScript types for the admin dashboard domain.
 * Inferred from backend route responses and database schema.
 * @module Module 10 — Admin Dashboard
 */

import type { Database } from '@/types/database.types';

// ─── Enums ────────────────────────────────────────────────────────────────────

/** Permission keys matching the admin_permission DB enum and backend requirePermission() checks. */
export type AdminPermission =
  | 'view_users'
  | 'manage_users'
  | 'view_listings'
  | 'moderate_listings'
  | 'view_payments'
  | 'process_refunds'
  | 'view_analytics'
  | 'manage_admins'
  | 'view_audit_logs'
  | 'review_sellers';

// ─── User Types ───────────────────────────────────────────────────────────────

/**
 * A platform user as returned by GET /admin/users and GET /admin/users/:id.
 * Maps to the `users` table Row type.
 */
export interface AdminUser {
  id: string;
  email: string;
  display_name: string | null;
  seller_tier: string;
  is_suspended: boolean;
  is_banned: boolean;
  created_at: string;
  last_login_at: string | null;
  ban_reason: string | null;
  banned_at: string | null;
  banned_until: string | null;
  age_verified: boolean;
  role: string;
  lifetime_sales_cents: number;
  preferred_brand: string | null;
}

/**
 * Stats returned alongside user detail from GET /admin/users/:id.
 */
export interface AdminUserStats {
  listingsCount: number;
  activeListingsCount: number;
  soldListingsCount: number;
}

/**
 * Full user detail response from GET /admin/users/:id.
 */
export interface AdminUserDetailResponse {
  user: AdminUser;
  stats: AdminUserStats;
}

/**
 * Paginated users list response from GET /admin/users.
 */
export interface UsersResponse {
  users: AdminUser[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

// ─── Moderation Types ─────────────────────────────────────────────────────────

/**
 * A listing joined into a moderation queue item.
 */
export interface ModerationListing {
  id: string;
  title: string;
  description: string | null;
  seller_id: string;
}

/**
 * A single item in the moderation queue, returned by GET /admin/moderation/queue.
 * Maps to the `moderation_queue` table Row with joined listings.
 */
export interface ModerationQueueItem {
  queue_id: string;
  listing_id: string;
  flagged_reason: string;
  flagged_by: string | null;
  flagged_by_system: boolean | null;
  status: string;
  priority: number | null;
  brand: string;
  created_at: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  action_taken: string | null;
  resolution_notes: string | null;
  listings: ModerationListing | null;
}

/**
 * Stats object returned alongside the moderation queue.
 */
export interface ModerationStats {
  pendingCount: number;
  inReviewCount: number;
}

/**
 * Full moderation queue response from GET /admin/moderation/queue.
 */
export interface ModerationQueueResponse {
  queue: ModerationQueueItem[];
  stats: ModerationStats;
}

// ─── Audit Log Types ──────────────────────────────────────────────────────────

/**
 * A single audit log entry, returned by GET /admin/audit-logs.
 * Maps to the `audit_logs` table Row type.
 */
export interface AuditLog {
  log_id: string;
  admin_id: string;
  admin_email: string;
  action: string;
  entity_type: string;
  entity_id: string;
  brand: string;
  changes: Record<string, unknown> | null;
  reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string | null;
}

/**
 * Paginated audit logs response from GET /admin/audit-logs.
 */
export interface AuditLogsResponse {
  logs: AuditLog[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

// ─── Health Types ─────────────────────────────────────────────────────────────

/**
 * Individual component health status.
 */
export interface HealthComponent {
  status: 'ok' | 'degraded' | 'down';
  latencyMs?: number;
  message?: string;
}

/**
 * Overall system health response from GET /admin/health.
 * Health endpoint may not be deployed — components may be absent.
 */
export interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  components?: Record<string, HealthComponent>;
}

// ─── Action Result ────────────────────────────────────────────────────────────

/**
 * Standard success response shape for admin POST actions.
 */
export interface AdminActionResult {
  success: boolean;
  message: string;
}

// ─── Seller Verification Types ──────────────────────────────────────────────

export interface SellerVerificationQueueItem {
  userId: string;
  email: string;
  displayName: string | null;
  status: string;
  submittedAt: string | null;
  createdAt: string;
  documentCount: number;
}

export interface SellerVerificationDocument {
  id: string;
  document_type: string;
  file_url: string;
  mime_type: string;
  file_size_bytes: number | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface SellerVerificationReview {
  id: string;
  admin_id: string;
  action: string;
  notes: string;
  previous_status: string;
  new_status: string;
  created_at: string;
}

// ─── Admin Auctions Types ────────────────────────────────────────────────────

export type AuctionStatus = Database['public']['Enums']['auction_status'];
export type ListingStatus = Database['public']['Enums']['listing_status'];
export type BrandType = Database['public']['Enums']['brand_type'];

/** One row in the /admin/auctions list — flattened summary of auction + listing + seller. */
export interface AdminAuctionRow {
  auction_id: string;
  listing_id: string | null;
  title: string | null;
  brand: BrandType | null;
  category_id: string | null;
  listing_status: ListingStatus | null;
  is_nsfw: boolean;
  status: AuctionStatus;
  current_price_cents: number;
  reserve_price_cents: number | null;
  currency: string;
  start_time: string;
  end_time: string;
  created_at: string;
  seller_id: string;
  seller_display_name: string | null;
  bid_count: number;
  thumbnail_url: string | null;
}

export interface AdminAuctionsListData {
  results: AdminAuctionRow[];
  total: number;
  page: number;
  totalPages: number;
}

export interface AdminAuctionsListResponse {
  success: true;
  data: AdminAuctionsListData;
}

/** Detail payload for /admin/auctions/:id. Embeds nested listing/seller/winner via PostgREST relations. */
type AuctionRow = Database['public']['Tables']['auctions']['Row'];
type ListingRow = Database['public']['Tables']['listings']['Row'];
type BidRow = Database['public']['Tables']['bids']['Row'];

export interface AdminAuctionUserRef {
  id: string;
  display_name: string | null;
  email?: string | null;
}

export interface AdminAuctionDetailAuction extends AuctionRow {
  listing: Pick<
    ListingRow,
    | 'id'
    | 'title'
    | 'description'
    | 'brand'
    | 'category_id'
    | 'condition'
    | 'status'
    | 'is_nsfw'
    | 'is_featured'
    | 'location_city'
    | 'location_country'
    | 'location_region'
    | 'requires_age_verification'
    | 'reserve_price_cents'
    | 'created_at'
    | 'updated_at'
  > | null;
  seller: AdminAuctionUserRef | null;
  high_bidder: AdminAuctionUserRef | null;
  winner: AdminAuctionUserRef | null;
}

export interface AdminAuctionMedia {
  id: string;
  type: string;
  url: string;
  thumbnail_url: string | null;
  sort_order: number;
  width: number | null;
  height: number | null;
}

export interface AdminAuctionBid extends Pick<BidRow, 'id' | 'amount_cents' | 'max_bid_cents' | 'is_auto_bid' | 'created_at' | 'bidder_id'> {
  bidder: AdminAuctionUserRef | null;
}

export interface AdminAuctionSettlementSummary {
  id: string;
  status: string;
  gross_amount_cents: number;
  net_amount_cents: number;
  platform_fee_cents: number;
  escrow_ends_at: string | null;
  escrow_released_at: string | null;
  delivery_confirmed_at: string | null;
  dispute_opened_at: string | null;
  settled_at: string | null;
  created_at: string;
}

export interface AdminAuctionDetailData {
  auction: AdminAuctionDetailAuction;
  media: AdminAuctionMedia[];
  bids: AdminAuctionBid[];
  settlement: AdminAuctionSettlementSummary | null;
}

export interface AdminAuctionDetailResponse {
  success: true;
  data: AdminAuctionDetailData;
}

export interface AdminAuctionActionResponse {
  success: true;
  data: unknown;
}

// ─── Seller Verification Types (existing) ───────────────────────────────────

export interface SellerVerificationDetail {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    status: string;
    submittedAt: string | null;
    reviewedAt: string | null;
    rejectionReason: string | null;
    sellerTier: string | null;
    createdAt: string;
  };
  documents: SellerVerificationDocument[];
  reviews: SellerVerificationReview[];
}
