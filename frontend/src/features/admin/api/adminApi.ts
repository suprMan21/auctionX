/**
 * Typed fetch wrapper for all admin backend endpoints.
 * Mirrors the pattern in lib/api.ts — uses supabase.auth.getSession() for the Bearer token.
 * All calls target the Express backend at VITE_API_URL/admin.
 * @module Module 10 — Admin Dashboard
 */

import { growthSchema, type GrowthBucket, type GrowthKind, type GrowthSeries } from './growthSchemas';
import { supabase } from '@/lib/supabase';
import type {
  ModerationQueueResponse,
  HealthStatus,
  AdminActionResult,
  SellerVerificationQueueItem,
  SellerVerificationDetail,
  AdminAuctionsListResponse,
  AdminAuctionDetailResponse,
  AdminAuctionActionResponse,
} from '../types/admin';

import {
  adminPricingSchema,
  cancelPriceResultSchema,
  grantVoucherResultSchema,
  parseEnvelope,
  revokeVoucherResultSchema,
  setPriceResultSchema,
  voucherListSchema,
  type AdminPricing,
  type AdminVoucherList,
  type PriceKind,
} from './pricingSchemas';

import {
  accountDetailSchema,
  accountSearchSchema,
  accountSettingsSchema,
  accountTokensSchema,
  actionResultSchema,
  adminMeSchema,
  auditFacetsSchema,
  auditLogListSchema,
  type AccountDetail,
  type AccountSearch,
  type AccountSettings,
  type AccountTokens,
  type AdminMe,
  type AuditFacets,
  type AuditLogList,
  type GrantableRole,
} from './accountSchemas';

import {
  approvalListSchema,
  approveResultSchema,
  decisionResultSchema,
  pendingApprovalOf,
  type ApprovalFilter,
  type ApprovalList,
  type ApprovalPending,
} from './approvalSchemas';

const ADMIN_BASE = `${import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1'}/admin`;

// ─── Auth Helper ─────────────────────────────────────────────────────────────

/**
 * Retrieves the Bearer token from the current Supabase session.
 * Throws if there is no active session.
 */
async function getAuthHeader(): Promise<{ Authorization: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new AdminApiError('Your session has ended. Sign in again.', 401, 'NO_SESSION');
  }
  return { Authorization: `Bearer ${session.access_token}` };
}

/** S-2FA: a one-time "Confirm it's you" grant for this exact action. */
const stepUpHeaders = (token?: string): Record<string, string> => (token ? { 'X-Step-Up': token } : {});

/** A non-2xx admin API answer. `message` is the server's safe text. */
export class AdminApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) {
    super(message);
    this.name = 'AdminApiError';
  }
}

// Any admin request the server refuses (401/403) may mean this admin's access
// was revoked or changed mid-session. The route guard listens and re-checks
// GET /admin/me straight away (S-ADMIN2: forced sign-out on revoke).
const refusalListeners = new Set<() => void>();

/** Subscribe to refused admin requests. Returns the unsubscribe function. */
export const onAdminRequestRefused = (listener: () => void): (() => void) => {
  refusalListeners.add(listener);
  return () => { refusalListeners.delete(listener); };
};

/**
 * Core fetch wrapper that attaches auth headers and parses JSON.
 * Throws an Error with the server's error message on non-2xx responses.
 */
async function adminFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const authHeader = await getAuthHeader();
  const response = await fetch(`${ADMIN_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeader,
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  if (!response.ok) {
    let message = 'Something went wrong on our side. Try again.';
    let code: string | null = null;
    try {
      const body = await response.json();
      message = body.error || message;
      code = typeof body.code === 'string' ? body.code : null;
    } catch {
      // body is not JSON: keep the generic message
    }
    if ((response.status === 401 || response.status === 403) && path !== '/me') {
      refusalListeners.forEach((listener) => listener());
    }
    throw new AdminApiError(message, response.status, code);
  }

  return response.json() as Promise<T>;
}

/** An account action's answer: null when it ran, the request when it waits for approval. */
const doneOrPending = (body: unknown): ApprovalPending | null => {
  const pending = pendingApprovalOf(body);
  if (pending) return pending;
  parseEnvelope(actionResultSchema, body);
  return null;
};

// ─── User Endpoints ───────────────────────────────────────────────────────────

export const adminApi = {
  // ─── S-ADMIN2: who am I, accounts, roles ────────────────────────────────────

  /** GET /admin/me — the caller's role and permissions. */
  async getMe(): Promise<AdminMe> {
    return parseEnvelope(adminMeSchema, await adminFetch<unknown>('/me'));
  },

  /** GET /admin/users — search by email, display name or id. A non-empty search is audit-logged. */
  async searchAccounts(params: { q?: string; status?: string; type?: string; page?: number; limit?: number } = {}): Promise<AccountSearch> {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.status) qs.set('status', params.status);
    if (params.type && params.type !== 'all') qs.set('type', params.type);
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    const query = qs.toString() ? `?${qs}` : '';
    return parseEnvelope(accountSearchSchema, await adminFetch<unknown>(`/users${query}`));
  },

  async getAccount(id: string): Promise<AccountDetail> {
    return parseEnvelope(accountDetailSchema, await adminFetch<unknown>(`/users/${encodeURIComponent(id)}`));
  },

  /** Token holdings + re-issue history. manage_nfc; the view is audit-logged. */
  async getAccountTokens(id: string): Promise<AccountTokens> {
    return parseEnvelope(accountTokensSchema, await adminFetch<unknown>(`/users/${encodeURIComponent(id)}/tokens`));
  },

  /** null = done. S-2FA Ph3a: a request sent for a second admin's approval (202) instead. */
  async suspendAccount(id: string, hours: number, reason: string): Promise<ApprovalPending | null> {
    return doneOrPending(await adminFetch<unknown>(`/users/${encodeURIComponent(id)}/suspend`, {
      method: 'POST', body: JSON.stringify({ hours, reason }),
    }));
  },

  /** null = done. Retire, and lifting a hold another admin set, may come back as a request sent for approval (202). */
  async accountAction(id: string, action: 'unsuspend' | 'retire' | 'reactivate', reason: string): Promise<ApprovalPending | null> {
    return doneOrPending(await adminFetch<unknown>(`/users/${encodeURIComponent(id)}/${action}`, {
      method: 'POST', body: JSON.stringify({ reason }),
    }));
  },

  async deleteAccount(id: string, confirm: string, reason: string): Promise<void> {
    parseEnvelope(actionResultSchema, await adminFetch<unknown>(`/users/${encodeURIComponent(id)}/delete`, {
      method: 'POST', body: JSON.stringify({ confirm, reason }),
    }));
  },

  /** role null revokes staff access. super_admin only. */
  async setAccountRole(id: string, role: GrantableRole | null, reason: string): Promise<void> {
    parseEnvelope(actionResultSchema, await adminFetch<unknown>(`/users/${encodeURIComponent(id)}/role`, {
      method: 'PUT', body: JSON.stringify({ role, reason }),
    }));
  },

  /** Collector / Creator. `override` makes a creator without an ID check (admin + super admin). */
  async setAccountType(id: string, type: 'collector' | 'creator', override: boolean, reason: string): Promise<void> {
    parseEnvelope(actionResultSchema, await adminFetch<unknown>(`/users/${encodeURIComponent(id)}/type`, {
      method: 'PUT', body: JSON.stringify({ type, override, reason }),
    }));
  },

  async getAccountSettings(): Promise<AccountSettings> {
    return parseEnvelope(accountSettingsSchema, await adminFetch<unknown>('/account-settings'));
  },

  async setDeleteWindow(hours: number, reason: string): Promise<void> {
    parseEnvelope(actionResultSchema, await adminFetch<unknown>('/account-settings', {
      method: 'PUT', body: JSON.stringify({ hours, reason }),
    }));
  },

  // ─── Moderation Endpoints ───────────────────────────────────────────────────

  /**
   * GET /admin/moderation/queue
   * Returns the moderation queue with optional status/brand/priority filters.
   */
  getModerationQueue(params?: {
    status?: string;
    brand?: string;
    priority?: number;
  }): Promise<ModerationQueueResponse> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.brand) qs.set('brand', params.brand);
    if (params?.priority != null) qs.set('priority', String(params.priority));
    const query = qs.toString() ? `?${qs}` : '';
    return adminFetch<ModerationQueueResponse>(`/moderation/queue${query}`);
  },

  /**
   * POST /admin/moderation/queue/:queueId/assign
   * Assigns the queue item to the current admin (sets status to in_review).
   */
  assignModeration(queueId: string): Promise<AdminActionResult> {
    return adminFetch<AdminActionResult>(`/moderation/queue/${queueId}/assign`, {
      method: 'POST',
    });
  },

  /**
   * POST /admin/moderation/queue/:queueId/resolve
   * Resolves a queue item with an action and required notes.
   */
  resolveModeration(
    queueId: string,
    action: string,
    notes: string
  ): Promise<AdminActionResult> {
    return adminFetch<AdminActionResult>(`/moderation/queue/${queueId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ action, notes }),
    });
  },

  // ─── Audit Log Endpoints ────────────────────────────────────────────────────

  /** GET /admin/audit-logs — filter by actor, action, entity type and target. */
  async getAuditLogs(params: {
    page?: number;
    limit?: number;
    action?: string;
    entity?: string;
    admin?: string;
    target?: string;
    /** ISO 8601 with offset; from inclusive, to exclusive. */
    from?: string;
    to?: string;
  } = {}): Promise<AuditLogList> {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.action) qs.set('action', params.action);
    if (params.entity) qs.set('entity', params.entity);
    if (params.admin) qs.set('admin', params.admin);
    if (params.target) qs.set('target', params.target);
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    const query = qs.toString() ? `?${qs}` : '';
    return parseEnvelope(auditLogListSchema, await adminFetch<unknown>(`/audit-logs${query}`));
  },

  /** Values for the audit-log filter dropdowns. */
  async getAuditFacets(): Promise<AuditFacets> {
    return parseEnvelope(auditFacetsSchema, await adminFetch<unknown>('/audit-logs/facets'));
  },

  // ─── Seller Verification Endpoints ─────────────────────────────────────────

  getSellerVerificationQueue(params?: {
    status?: string;
    page?: number;
  }): Promise<{ success: boolean; data: { queue: SellerVerificationQueueItem[]; pagination: { page: number; limit: number; total: number }; stats: { pendingCount: number } } }> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.page) qs.set('page', String(params.page));
    const query = qs.toString() ? `?${qs}` : '';
    return adminFetch(`/seller-verification/queue${query}`);
  },

  getSellerVerificationDetail(userId: string): Promise<{ success: boolean; data: SellerVerificationDetail }> {
    return adminFetch(`/seller-verification/${userId}`);
  },

  approveSellerVerification(userId: string, notes: string): Promise<AdminActionResult> {
    return adminFetch<AdminActionResult>(`/seller-verification/${userId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    });
  },

  rejectSellerVerification(userId: string, reason: string, notes: string): Promise<AdminActionResult> {
    return adminFetch<AdminActionResult>(`/seller-verification/${userId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason, notes }),
    });
  },

  revokeSellerVerification(userId: string, reason: string, notes: string): Promise<AdminActionResult> {
    return adminFetch<AdminActionResult>(`/seller-verification/${userId}/revoke`, {
      method: 'POST',
      body: JSON.stringify({ reason, notes }),
    });
  },

  // ─── Escrow Endpoints ───────────────────────────────────────────────────────

  /** GET /admin/escrow/summary — dashboard counts/totals + last 10 reconciliation logs. */
  getEscrowSummary(): Promise<EscrowSummaryResponse> {
    return adminFetch<EscrowSummaryResponse>('/escrow/summary');
  },

  /** GET /admin/escrow?status=...&page=...&limit=... — paginated settlements. */
  listEscrowSettlements(params?: {
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<EscrowListResponse> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));
    const query = qs.toString() ? `?${qs}` : '';
    return adminFetch<EscrowListResponse>(`/escrow${query}`);
  },

  /** GET /admin/escrow/reconciliation-logs?limit=... — recent watchdog runs. */
  listEscrowReconciliationLogs(limit = 50): Promise<EscrowLogsResponse> {
    return adminFetch<EscrowLogsResponse>(`/escrow/reconciliation-logs?limit=${limit}`);
  },

  /** POST /admin/escrow/:id/release — manual release of a stuck or disputed settlement. */
  manualReleaseEscrow(settlementId: string): Promise<EscrowReleaseResponse> {
    return adminFetch<EscrowReleaseResponse>(`/escrow/${settlementId}/release`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  // ─── Auctions Endpoints ────────────────────────────────────────────────────

  /** GET /admin/auctions — paginated/filterable list of auctions joined with listing + seller. */
  listAuctions(params?: {
    page?: number;
    limit?: number;
    status?: string[];
    brand?: string;
    category?: string;
    seller?: string;
    search?: string;
    sort?: 'end_time_asc' | 'end_time_desc' | 'current_price_desc' | 'created_at_desc';
  }): Promise<AdminAuctionsListResponse> {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.status && params.status.length > 0) qs.set('status', params.status.join(','));
    if (params?.brand) qs.set('brand', params.brand);
    if (params?.category) qs.set('category', params.category);
    if (params?.seller) qs.set('seller', params.seller);
    if (params?.search) qs.set('search', params.search);
    if (params?.sort) qs.set('sort', params.sort);
    const query = qs.toString() ? `?${qs}` : '';
    return adminFetch<AdminAuctionsListResponse>(`/auctions${query}`);
  },

  /** GET /admin/auctions/:id — full detail with bid history + settlement summary. */
  getAuctionDetail(id: string): Promise<AdminAuctionDetailResponse> {
    return adminFetch<AdminAuctionDetailResponse>(`/auctions/${id}`);
  },

  /** POST /admin/auctions/:id/end — force-end ACTIVE auction. */
  endAuction(id: string): Promise<AdminAuctionActionResponse> {
    return adminFetch<AdminAuctionActionResponse>(`/auctions/${id}/end`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  /** POST /admin/auctions/:id/cancel — cancel auction + its listing. Reason required. */
  cancelAuction(id: string, reason: string): Promise<AdminAuctionActionResponse> {
    return adminFetch<AdminAuctionActionResponse>(`/auctions/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  /**
   * POST /admin/auctions/:id/restart — hard restart of an ENDED or CANCELLED auction.
   * Wipes bids, resets current_price to starting_price, status → ACTIVE, listing → ACTIVE.
   * Allowed durationHours: 1..720.
   */
  restartAuction(id: string, reason: string, durationHours: number): Promise<AdminAuctionActionResponse> {
    return adminFetch<AdminAuctionActionResponse>(`/auctions/${id}/restart`, {
      method: 'POST',
      body: JSON.stringify({ reason, durationHours }),
    });
  },

  /** POST /admin/auctions/:id/settle — force-settle ENDED auction (delegates to Edge Function). */
  triggerSettle(id: string): Promise<AdminAuctionActionResponse> {
    return adminFetch<AdminAuctionActionResponse>(`/auctions/${id}/settle`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  // ─── Health Endpoint ────────────────────────────────────────────────────────

  /**
   * GET /admin/health
   * Returns system health status.
   * May return 404 if the endpoint has not been deployed yet.
   */
  getHealth(): Promise<HealthStatus> {
    return adminFetch<HealthStatus>('/health');
  },

  // ─── Yoti Verifications Endpoints (S22) ─────────────────────────────────────

  /** GET /admin/verifications — list users with at least one yoti_sessions row. */
  listYotiVerifications(params?: {
    status?: string; // comma-separated list of verification_status
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<AdminYotiVerificationsListResponse> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.search) qs.set('search', params.search);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));
    const query = qs.toString() ? `?${qs}` : '';
    return adminFetch<AdminYotiVerificationsListResponse>(`/verifications${query}`);
  },

  /** GET /admin/verifications/:userId — full detail: user + sessions + review history. */
  getYotiVerificationDetail(userId: string): Promise<AdminYotiVerificationDetailResponse> {
    return adminFetch<AdminYotiVerificationDetailResponse>(`/verifications/${userId}`);
  },

  /** POST /admin/verifications/:userId/override — manual override with audit. */
  overrideYotiVerification(
    userId: string,
    new_status: AdminYotiVerificationStatus,
    reason: string,
  ): Promise<AdminYotiVerificationOverrideResponse> {
    return adminFetch<AdminYotiVerificationOverrideResponse>(
      `/verifications/${userId}/override`,
      {
        method: 'POST',
        body: JSON.stringify({ new_status, reason }),
      },
    );
  },

  // ─── Token Admin Endpoints (S-ADMIN1) ───────────────────────────────────────
  // All require manage_nfc. Responses use the { success, data, error } envelope.

  /** GET /admin/tags — tag inventory with optional filters. */
  listTags(params: AdminTagListParams = {}): Promise<AdminTagListResponse> {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') qs.set(key, String(value));
    }
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return adminFetch<AdminTagListResponse>(`/tags${query}`);
  },

  /** GET /admin/tags/:tagId — timeline, custody, taps, audit. */
  getTag(tagId: string): Promise<AdminTagDetailResponse> {
    return adminFetch<AdminTagDetailResponse>(`/tags/${encodeURIComponent(tagId)}`);
  },

  /** POST /admin/tags/:tagId/suspend | /unsuspend — typed reason required. */
  setTagSuspension(tagId: string, suspend: boolean, reason: string): Promise<AdminTagSuspensionResponse | AdminApprovalPendingResponse> {
    return adminFetch<AdminTagSuspensionResponse | AdminApprovalPendingResponse>(
      `/tags/${encodeURIComponent(tagId)}/${suspend ? 'suspend' : 'unsuspend'}`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    );
  },

  /** POST /admin/tags/:tagId/reset — atomic token reset onto an ENROLLED chip. */
  resetTag(
    tagId: string,
    body: { newTagId: string; reason: string; confirmSuffix: string },
  ): Promise<AdminTagResetResponse | AdminApprovalPendingResponse> {
    return adminFetch<AdminTagResetResponse | AdminApprovalPendingResponse>(
      `/tags/${encodeURIComponent(tagId)}/reset`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },

  // ─── Two-admin approval (S-2FA Ph3a) ────────────────────────────────────────
  // manage_nfc or manage_users; the server shows only the actions this admin may approve.

  /** GET /admin/approvals — waiting_for_me = pending requests by someone else. */
  async listApprovals(params: { status?: ApprovalFilter; id?: string; page?: number; limit?: number } = {}): Promise<ApprovalList> {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) qs.set(key, String(value));
    }
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return parseEnvelope(approvalListSchema, await adminFetch<unknown>(`/approvals${query}`));
  },

  /** Always needs a fresh passkey check (step-up action admin_approve, target = the request id). */
  async approveApproval(id: string, stepUpToken?: string) {
    return parseEnvelope(
      approveResultSchema,
      await adminFetch<unknown>(`/approvals/${encodeURIComponent(id)}/approve`, {
        method: 'POST', body: '{}', headers: stepUpHeaders(stepUpToken),
      }),
    );
  },

  /** reason: 10–500 characters. */
  async rejectApproval(id: string, reason: string) {
    return parseEnvelope(
      decisionResultSchema,
      await adminFetch<unknown>(`/approvals/${encodeURIComponent(id)}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
    );
  },

  /** The requester withdraws their own request. */
  async cancelApproval(id: string) {
    return parseEnvelope(
      decisionResultSchema,
      await adminFetch<unknown>(`/approvals/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' }),
    );
  },

  // ─── Re-issue queue (S-ADMIN1 Ph2) ──────────────────────────────────────────

  /** GET /admin/reissue-requests?status= — the queue, oldest first for open filters. */
  listReissueRequests(params: { status?: AdminReissueFilter; id?: string; page?: number; limit?: number } = {}): Promise<AdminReissueListResponse> {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) qs.set(key, String(value));
    }
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return adminFetch<AdminReissueListResponse>(`/reissue-requests${query}`);
  },

  /** Approve (charge the fee, or waive it with the reason) or reject. Nothing is charged here. */
  reviewReissue(
    requestId: string,
    decision: 'approve' | 'approve_waived' | 'reject',
    reason: string,
  ): Promise<AdminReissueReviewResponse> {
    const action = decision === 'reject' ? 'reject' : 'approve';
    const body = decision === 'reject' ? { reason } : { reason, waive: decision === 'approve_waived' };
    return adminFetch<AdminReissueReviewResponse>(
      `/reissue-requests/${encodeURIComponent(requestId)}/${action}`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },

  /**
   * POST /admin/reissue-requests/:id/fulfil — only once PAID or WAIVED.
   * S-2FA Ph3a2: 202 (sent for a second admin's approval) whenever /admin/me says approvalRequired.
   */
  fulfilReissue(
    requestId: string,
    body: { newTagId: string; reason: string; confirmSuffix: string },
  ): Promise<AdminTagResetResponse | AdminApprovalPendingResponse> {
    return adminFetch<AdminTagResetResponse | AdminApprovalPendingResponse>(
      `/reissue-requests/${encodeURIComponent(requestId)}/fulfil`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },

  // ─── Stuck payments (S-ADMIN1 Ph3a) ─────────────────────────────────────────

  /** GET /admin/stuck-payments?status= — token fees Stripe took that did not apply. */
  listStuckPayments(params: { status?: AdminStuckPaymentFilter; page?: number; limit?: number } = {}): Promise<AdminStuckPaymentListResponse> {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) qs.set(key, String(value));
    }
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return adminFetch<AdminStuckPaymentListResponse>(`/stuck-payments${query}`);
  },

  /** Re-runs the apply for a paid fee. The server asks Stripe first. */
  reapplyStuckPayment(incidentId: string, reason: string): Promise<AdminStuckPaymentReapplyResponse> {
    return adminFetch<AdminStuckPaymentReapplyResponse>(
      `/stuck-payments/${encodeURIComponent(incidentId)}/reapply`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    );
  },

  /** Full refund. Admin and super_admin only. */
  refundStuckPayment(
    incidentId: string,
    body: { reason: string; confirmSuffix: string },
  ): Promise<AdminStuckPaymentRefundResponse> {
    return adminFetch<AdminStuckPaymentRefundResponse>(
      `/stuck-payments/${encodeURIComponent(incidentId)}/refund`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },

  /** Runs the reconciliation check now instead of waiting for the 10-minute tick. */
  sweepStuckPayments(): Promise<AdminStuckPaymentSweepResponse> {
    return adminFetch<AdminStuckPaymentSweepResponse>('/stuck-payments/sweep', { method: 'POST', body: '{}' });
  },

  // ─── Prices + free-transfer vouchers (S-ADMIN1 Ph3b; admin + super_admin) ──

  /** GET /admin/pricing — prices in effect, launch defaults, and history (newest first). */
  async getPricing(): Promise<AdminPricing> {
    return parseEnvelope(adminPricingSchema, await adminFetch<unknown>('/pricing'));
  },

  /** POST /admin/pricing — effectiveFrom null = now; a future time schedules it. */
  async setPrice(body: { kind: PriceKind; amountUsdCents: number; effectiveFrom: string | null; reason: string }, stepUpToken?: string) {
    return parseEnvelope(
      setPriceResultSchema,
      await adminFetch<unknown>('/pricing', { method: 'POST', body: JSON.stringify(body), headers: stepUpHeaders(stepUpToken) }),
    );
  },

  /** POST /admin/pricing/:id/cancel — scheduled changes only. */
  async cancelPrice(priceId: string, reason: string, stepUpToken?: string) {
    return parseEnvelope(
      cancelPriceResultSchema,
      await adminFetch<unknown>(`/pricing/${encodeURIComponent(priceId)}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
        headers: stepUpHeaders(stepUpToken),
      }),
    );
  },

  /** GET /admin/stats/growth — UX-3 dashboard counts; from/to are the viewer's local days (inclusive). */
  async getGrowth(params: { series: GrowthKind; from: string; to: string; bucket: GrowthBucket; tz: string }): Promise<GrowthSeries> {
    const qs = new URLSearchParams(params);
    return parseEnvelope(growthSchema, await adminFetch<unknown>(`/stats/growth?${qs.toString()}`));
  },

  /** GET /admin/vouchers — email is an exact account email; the server audit-logs the lookup. */
  async listVoucherGrants(params: { email?: string; page?: number; limit?: number } = {}): Promise<AdminVoucherList> {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') qs.set(key, String(value));
    }
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return parseEnvelope(voucherListSchema, await adminFetch<unknown>(`/vouchers${query}`));
  },

  /** POST /admin/vouchers — expiresAt null = never expires. */
  async grantVouchers(body: { email: string; quantity: number; reason: string; expiresAt: string | null }) {
    return parseEnvelope(
      grantVoucherResultSchema,
      await adminFetch<unknown>('/vouchers', { method: 'POST', body: JSON.stringify(body) }),
    );
  },

  /** POST /admin/vouchers/:id/revoke — cancels the grant's unused free transfers. */
  async revokeVoucherGrant(grantId: string, reason: string) {
    return parseEnvelope(
      revokeVoucherResultSchema,
      await adminFetch<unknown>(`/vouchers/${encodeURIComponent(grantId)}/revoke`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    );
  },
};

// ─── Yoti Verifications Response Types (S22) ────────────────────────────────

export type AdminYotiVerificationStatus =
  | 'NONE'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'VIDEO_UPLOADED'
  | 'NFC_PROGRAMMED'
  | 'VERIFIED'
  | 'FLAGGED'
  | 'REVOKED';

export interface AdminYotiVerificationListRow {
  user_id: string;
  email: string;
  display_name: string | null;
  status: AdminYotiVerificationStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  age_verified: boolean;
  age_verified_at: string | null;
  yoti_session_id: string | null;
  yoti_last_event_at: string | null;
  joined_at: string;
}

export interface AdminYotiVerificationsListResponse {
  success: true;
  data: {
    results: AdminYotiVerificationListRow[];
    total: number;
    page: number;
    totalPages: number;
  };
}

export interface AdminYotiSessionRow {
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

export interface AdminYotiVerificationReview {
  id: string;
  admin_id: string;
  action: string;
  notes: string;
  previous_status: string;
  new_status: string;
  created_at: string;
}

export interface AdminYotiVerificationUserDetail {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  seller_verification_status: AdminYotiVerificationStatus;
  seller_verification_submitted_at: string | null;
  seller_verification_reviewed_at: string | null;
  seller_verification_rejection_reason: string | null;
  age_verified: boolean;
  age_verified_at: string | null;
  age_verification_provider: string | null;
  yoti_session_id: string | null;
  yoti_age_estimate: number | null;
  yoti_last_event_at: string | null;
  created_at: string;
}

export interface AdminYotiVerificationDetailResponse {
  success: true;
  data: {
    user: AdminYotiVerificationUserDetail;
    sessions: AdminYotiSessionRow[];
    reviews: AdminYotiVerificationReview[];
  };
}

export interface AdminYotiVerificationOverrideResponse {
  success: true;
  data: {
    user_id: string;
    previous_status: AdminYotiVerificationStatus;
    new_status: AdminYotiVerificationStatus;
    reason: string;
  };
}

// ─── Escrow Response Types ──────────────────────────────────────────────────

export interface EscrowSettlement {
  id: string;
  status: string;
  gross_amount_cents: number | null;
  net_amount_cents: number | null;
  platform_fee_cents: number | null;
  escrow_ends_at: string | null;
  escrow_released_at: string | null;
  dispute_opened_at: string | null;
  dispute_reason: string | null;
  created_at: string;
  seller_id: string;
  buyer_id: string | null;
  transaction_id: string | null;
  auction_id: string | null;
}

export interface EscrowReconciliationLog {
  run_at: string;
  total_checked: number;
  stuck_released: number;
  orphaned_flagged: number;
  disputed_aged: number;
  summary?: string | null;
  errors?: unknown;
}

export interface EscrowSummaryResponse {
  success: true;
  data: {
    escrowHold: { count: number; totalCents: number };
    disputed: { count: number };
    released30d: { totalCents: number };
    recentReconciliationLogs: EscrowReconciliationLog[];
  };
}

export interface EscrowListResponse {
  success: true;
  data: {
    settlements: EscrowSettlement[];
    total: number;
    page: number;
    limit: number;
  };
}

export interface EscrowLogsResponse {
  success: true;
  data: EscrowReconciliationLog[];
}

export interface EscrowReleaseResponse {
  success: true;
  settlementId: string;
  status: 'RELEASED';
  payoutCreated: boolean;
}

// ─── Token Admin Types (S-ADMIN1) ───────────────────────────────────────────

export type AdminTagLifecycleStatus =
  | 'ENROLLED' | 'CLAIMED' | 'ASSOCIATED' | 'ACTIVE' | 'RELEASED' | 'TRANSFERRED' | 'RETIRED' | 'SUSPENDED';

export interface AdminTagListParams {
  /** One search: owner email (partial), chip name, serial suffix or UID suffix. Audit-logged. */
  q?: string;
  status?: AdminTagLifecycleStatus;
  uidSuffix?: string;
  itemId?: string;
  creatorId?: string;
  keyVersion?: number;
  page?: number;
  limit?: number;
}

/** A chip as admins see it. Never the full UID, keys, salts or Ownership ID. */
export interface AdminTag {
  id: string;
  /** The name in the chip's URL (chip_NNN); null on chips enrolled before names were recorded. */
  chipName?: string | null;
  uidSuffix: string;
  /** S-NFC-ID: last 6 of the chip serial (v2 chips); tells apart chips sharing a UID. */
  serialSuffix?: string | null;
  lifecycleStatus: AdminTagLifecycleStatus | null;
  ownerAccountId: string | null;
  ownerEmail?: string | null;
  creatorAccountId: string | null;
  creatorEmail?: string | null;
  itemId: string | null;
  sdmKeyVersion: number | null;
  sunCounter: number;
  registeredAt: string | null;
  activatedAt: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  retiredAt: string | null;
  retiredReason: string | null;
  replacedByTagId: string | null;
  destructionStatus: 'PENDING' | 'DESTROYED' | null;
}

/**
 * `…936980`, or `…936980 · sn …AE6CA9` for a v2 chip (chips can share a UID),
 * led by the chip's name when it has one: `chip_004 · …936980 · sn …8A0351`.
 */
export const chipLabel = (tag: Pick<AdminTag, 'chipName' | 'uidSuffix' | 'serialSuffix'>): string => {
  const ids = tag.serialSuffix ? `…${tag.uidSuffix} · sn …${tag.serialSuffix}` : `…${tag.uidSuffix}`;
  return tag.chipName ? `${tag.chipName} · ${ids}` : ids;
};

/**
 * What an admin types to confirm retiring a chip: the serial suffix of a v2 chip
 * (every chip in the current lot ends in UID …936980), else the UID suffix.
 */
export const confirmationSuffixOf = (tag: Pick<AdminTag, 'uidSuffix' | 'serialSuffix'>): string =>
  (tag.serialSuffix ?? tag.uidSuffix).toUpperCase();

export interface AdminTagListResponse {
  success: true;
  data: {
    tags: AdminTag[];
    pagination: { page: number; limit: number; total: number };
    /** More than 50 accounts matched the email search; only the first 50 were used. */
    emailMatchesTruncated?: boolean;
  };
}

export interface AdminTagCustodyRow {
  id: string;
  type: string;
  status: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  /** The account's own email (not what a sender typed). */
  fromEmail?: string | null;
  toEmail?: string | null;
  initiatedAt: string | null;
  completedAt: string | null;
  chargedAmount: number | null;
  chargedCurrency: string | null;
  reissue: boolean;
}

export interface AdminTagTapRow {
  id: string;
  at: string;
  type: string;
  valid: boolean | null;
  counter: number | null;
  accountId: string | null;
  accountEmail?: string | null;
}

export interface AdminTagAuditRow {
  id: string;
  action: string;
  adminEmail: string;
  reason: string | null;
  changes: unknown;
  at: string | null;
}

export interface AdminTagDetailResponse {
  success: true;
  data: {
    tag: AdminTag;
    replacesTagIds: string[];
    ownershipId: { status: 'current' | 'none'; issuedAt: string | null; anchoredAt: string | null };
    custody: AdminTagCustodyRow[];
    taps: AdminTagTapRow[];
    audit: AdminTagAuditRow[];
  };
}

/** S-2FA Ph3a: HTTP 202, the action waits for a second admin. */
export interface AdminApprovalPendingResponse {
  success: true;
  data: ApprovalPending;
}

export interface AdminTagSuspensionResponse {
  success: true;
  data: { tagId: string; lifecycleStatus: AdminTagLifecycleStatus };
}

export interface AdminTagResetResponse {
  success: true;
  data: {
    oldTagId: string;
    newTagId: string;
    oldLifecycleStatus: 'RETIRED';
    newLifecycleStatus: 'ACTIVE';
    destructionStatus: 'PENDING';
  };
}

// ─── Re-issue Queue Types (S-ADMIN1 Ph2) ────────────────────────────────────

export type AdminReissueFilter = 'NEEDS_ACTION' | 'PENDING' | 'AWAITING_PAYMENT' | 'READY' | 'DONE' | 'REJECTED' | 'CANCELLED' | 'ALL';

export interface AdminReissueRequest {
  id: string;
  tagId: string;
  tag: {
    chipName?: string | null;
    uidSuffix: string;
    serialSuffix: string | null;
    lifecycleStatus: AdminTagLifecycleStatus | null;
    sdmKeyVersion: number | null;
    requesterStillOwner: boolean;
  } | null;
  requesterAccountId: string;
  requesterEmail?: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  paymentStatus: 'AWAITING_PAYMENT' | 'PAID' | 'WAIVED' | null;
  listAmountUsdCents: number | null;
  chargedAmount: number | null;
  chargedCurrency: string | null;
  photoCount: number;
  /** 5-minute presigned links; empty for closed requests. */
  photoUrls: string[];
  tappedAt: string | null;
  reviewReason: string | null;
  waiveReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  paidAt: string | null;
  fulfilledAt: string | null;
  newTagId: string | null;
  /** The new chip's name (or serial suffix), once moved. */
  newTagLabel?: string | null;
  createdAt: string;
}

export interface AdminReissueListResponse {
  success: true;
  data: { requests: AdminReissueRequest[]; pagination: { page: number; limit: number; total: number } };
}

export interface AdminReissueReviewResponse {
  success: true;
  data: { reissueRequestId: string; status: string; paymentStatus: string | null };
}

// ─── Stuck payments (S-ADMIN1 Ph3a) ──────────────────────────────────────────

export type AdminStuckPaymentFilter = 'OPEN' | 'RESOLVED' | 'REFUNDED' | 'ALL';

export type AdminStuckPaymentReason =
  | 'webhook_missed' | 'apply_failed' | 'no_recipient' | 'not_payable' | 'intent_mismatch' | 'row_missing';

export interface AdminStuckPayment {
  id: string;
  kind: 'transfer_fee' | 'reissue_fee';
  reason: AdminStuckPaymentReason;
  status: 'OPEN' | 'RESOLVED' | 'REFUNDED';
  resolution: 'webhook' | 'sweep' | 'reapply' | 'refund' | null;
  transferId: string | null;
  reissueRequestId: string | null;
  paymentIntentId: string;
  /** Minor units (cents). */
  amount: number | null;
  currency: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
  lastError: string | null;
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  resolvedAt: string | null;
  refundId: string | null;
  /** What the payment points at, as it is now. Null when the row no longer exists. */
  target: {
    tagId: string | null;
    chipName: string | null;
    status: string | null;
    paymentStatus: string | null;
    /** Re-issue only: the new chip is already done. */
    fulfilled?: boolean;
  } | null;
}

export interface AdminStuckPaymentListResponse {
  success: true;
  data: {
    items: AdminStuckPayment[];
    total: number;
    page: number;
    limit: number;
    canRefund: boolean;
    githubIssuesConfigured: boolean;
    sweepConfigured: boolean;
  };
}

export interface AdminStuckPaymentReapplyResponse {
  success: true;
  data: { incidentId: string; status: 'RESOLVED'; outcome: string };
}

export interface AdminStuckPaymentRefundResponse {
  success: true;
  data: { incidentId: string; status: 'REFUNDED'; refundId: string; transferCancelled: boolean };
}

export interface AdminStuckPaymentSweepResponse {
  success: true;
  data: {
    scanned: number; checked: number; settled: number; applied: number; stuck: number;
    skippedRecent: number; skippedRefunded: number; truncated: boolean;
  };
}
