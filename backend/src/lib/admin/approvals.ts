/**
 * S-2FA Ph3a — two-admin approval (Boss 2026-10-27).
 *
 * The daily admins approve each other's token reset, token suspend, account
 * suspend and account retire. super_admin is break-glass and acts alone (its
 * role holds `act_without_approval`). The rules that must never be skipped
 * (audit first, not your own request, one open request per target, 24 h) live
 * in the database functions of migration 20261027000012.
 */

import { createHash } from 'crypto';
import { z } from 'zod';
import { isAdminTwoPersonRequired } from '../featureFlags';
import { hasPermission, PERMISSIONS, type AdminPermission } from './permissions';

export const APPROVAL_ACTIONS = ['tag_reset', 'tag_suspend', 'account_suspend', 'account_retire'] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

/** Same mapping as admin_approval_permission() in the database. */
export const APPROVAL_PERMISSION: Record<ApprovalAction, AdminPermission> = {
  tag_reset: PERMISSIONS.manageNfc,
  tag_suspend: PERMISSIONS.manageNfc,
  account_suspend: PERMISSIONS.manageUsers,
  account_retire: PERMISSIONS.manageUsers,
};

/** True when this admin's destructive action must wait for a second admin. */
export const approvalRequired = (admin: { permissions?: readonly string[] } | undefined): boolean =>
  isAdminTwoPersonRequired() && !hasPermission(admin, PERMISSIONS.actWithoutApproval);

/** The approval actions this admin may see, request and decide. */
export const visibleApprovalActions = (admin: { permissions?: readonly string[] } | undefined): ApprovalAction[] =>
  APPROVAL_ACTIONS.filter((a) => hasPermission(admin, APPROVAL_PERMISSION[a]));

/**
 * JSON with object keys sorted at every level. Postgres jsonb reorders keys, so
 * the hash of a stored payload is only stable over a canonical form.
 */
export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

/**
 * Integrity check only (accidental corruption, a code path that rewrites the
 * payload). It is not tamper-proof against someone who can write the row, who
 * could rewrite the hash too; the table is service_role only.
 */
export const payloadHash = (payload: unknown): string =>
  createHash('sha256').update(canonicalJson(payload)).digest('hex');

// ── Request shapes ──────────────────────────────────────────────────────────

export const APPROVAL_STATUSES = ['waiting_for_me', 'open', 'closed', 'all'] as const;

export const listApprovalsQuerySchema = z.object({
  status: z.enum(APPROVAL_STATUSES).default('open'),
  /** One request (a deep link `?request=<id>`). */
  id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const approvalIdParamSchema = z.string().uuid();

export const rejectBodySchema = z.object({
  reason: z.string().trim().min(10).max(500),
}).strict();

export const emptyBodySchema = z.object({}).strict();

/** Known approval function errors -> [code, message]. The raw DB text never reaches the client. */
export const APPROVAL_ERRORS: Record<string, [code: 'conflict' | 'not_found' | 'permission_denied' | 'invalid_argument', message: string]> = {
  approval_pending: ['conflict', 'This already has a request waiting for approval. Approve, reject or cancel that one first.'],
  approval_not_found: ['not_found', 'Approval request not found.'],
  approval_closed: ['conflict', 'This request has already been decided. Reload the page.'],
  approval_expired: ['conflict', 'This request expired after 24 hours. Ask again if it is still needed.'],
  same_admin: ['permission_denied', 'A different admin must approve or reject your request.'],
  not_requester: ['permission_denied', 'Only the admin who asked can cancel this request.'],
  self_action: ['permission_denied', 'You cannot do this to your own account.'],
  requester_inactive: ['conflict', 'The admin who asked no longer has access, so this request cannot run.'],
  reason_required: ['invalid_argument', 'Give a reason of at least 10 characters.'],
  admin_forbidden: ['permission_denied', 'Your staff role cannot do this.'],
  invalid_action: ['invalid_argument', 'Some details are missing or not valid. Check the form and try again.'],
  invalid_argument: ['invalid_argument', 'Some details are missing or not valid. Check the form and try again.'],
};
