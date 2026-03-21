/**
 * Typed fetch wrapper for all admin backend endpoints.
 * Mirrors the pattern in lib/api.ts — uses supabase.auth.getSession() for the Bearer token.
 * All calls target the Express backend at VITE_API_URL/admin.
 * @module Module 10 — Admin Dashboard
 */

import { supabase } from '@/lib/supabase';
import type {
  UsersResponse,
  AdminUserDetailResponse,
  ModerationQueueResponse,
  AuditLogsResponse,
  HealthStatus,
  AdminActionResult,
  SellerVerificationQueueItem,
  SellerVerificationDetail,
} from '../types/admin';

const ADMIN_BASE = `${import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1'}/admin`;

// ─── Auth Helper ─────────────────────────────────────────────────────────────

/**
 * Retrieves the Bearer token from the current Supabase session.
 * Throws if there is no active session.
 */
async function getAuthHeader(): Promise<{ Authorization: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Not authenticated');
  }
  return { Authorization: `Bearer ${session.access_token}` };
}

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
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      message = body.error || message;
    } catch {
      // body is not JSON — keep the HTTP status message
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

// ─── User Endpoints ───────────────────────────────────────────────────────────

export const adminApi = {
  /**
   * GET /admin/users
   * Returns paginated user list with optional search/status/page filters.
   */
  listUsers(params?: {
    search?: string;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<UsersResponse> {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    if (params?.status) qs.set('status', params.status);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));
    const query = qs.toString() ? `?${qs}` : '';
    return adminFetch<UsersResponse>(`/users${query}`);
  },

  /**
   * GET /admin/users/:id
   * Returns full user detail and listing stats.
   */
  getUser(id: string): Promise<AdminUserDetailResponse> {
    return adminFetch<AdminUserDetailResponse>(`/users/${id}`);
  },

  /**
   * POST /admin/users/:id/suspend
   * Suspends a user for the given duration with a required reason.
   */
  suspendUser(id: string, durationHours: number, reason: string): Promise<AdminActionResult> {
    return adminFetch<AdminActionResult>(`/users/${id}/suspend`, {
      method: 'POST',
      body: JSON.stringify({ durationHours, reason }),
    });
  },

  /**
   * POST /admin/users/:id/unsuspend
   * Lifts an active suspension from a user.
   */
  unsuspendUser(id: string): Promise<AdminActionResult> {
    return adminFetch<AdminActionResult>(`/users/${id}/unsuspend`, {
      method: 'POST',
    });
  },

  /**
   * POST /admin/users/:id/ban
   * Permanently bans a user with a required reason.
   */
  banUser(id: string, reason: string): Promise<AdminActionResult> {
    return adminFetch<AdminActionResult>(`/users/${id}/ban`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  /**
   * POST /admin/users/:id/unban
   * Lifts a permanent ban from a user.
   */
  unbanUser(id: string): Promise<AdminActionResult> {
    return adminFetch<AdminActionResult>(`/users/${id}/unban`, {
      method: 'POST',
    });
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

  /**
   * GET /admin/audit-logs
   * Returns paginated audit log entries with optional filters.
   */
  getAuditLogs(params?: {
    page?: number;
    limit?: number;
    action?: string;
    entity?: string;
    admin?: string;
  }): Promise<AuditLogsResponse> {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.action) qs.set('action', params.action);
    if (params?.entity) qs.set('entity', params.entity);
    if (params?.admin) qs.set('admin', params.admin);
    const query = qs.toString() ? `?${qs}` : '';
    return adminFetch<AuditLogsResponse>(`/audit-logs${query}`);
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

  // ─── Health Endpoint ────────────────────────────────────────────────────────

  /**
   * GET /admin/health
   * Returns system health status.
   * May return 404 if the endpoint has not been deployed yet.
   */
  getHealth(): Promise<HealthStatus> {
    return adminFetch<HealthStatus>('/health');
  },
};
