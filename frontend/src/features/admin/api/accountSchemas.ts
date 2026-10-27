/**
 * S-ADMIN2 Ph1 — response shapes for accounts, roles and the audit trail.
 * Every response is validated: a shape the page does not expect is an error.
 */

import { z } from 'zod';

export const GRANTABLE_ROLES = ['super_admin', 'admin', 'support'] as const;
export type GrantableRole = (typeof GRANTABLE_ROLES)[number];

export const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super admin',
  admin: 'Admin',
  support: 'Support',
};

export const ACCOUNT_STATUSES = ['active', 'suspended', 'retired'] as const;

/**
 * Account type (2026-10-27). Set only by the database: Creator = asked to be a
 * creator AND passed the identity check. Staff is the staff role, not a type.
 */
export const ACCOUNT_TYPES = ['collector', 'creator'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const adminMeSchema = z.object({
  adminId: z.string(),
  email: z.string(),
  role: z.string(),
  permissions: z.array(z.string()),
});
export type AdminMe = z.infer<typeof adminMeSchema>;

const pagination = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  pages: z.number().int(),
});

export const accountSummarySchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  display_name: z.string().nullable(),
  created_at: z.string(),
  last_sign_in_at: z.string().nullable(),
  status: z.enum(ACCOUNT_STATUSES),
  staff_role: z.string().nullable(),
  account_type: z.enum(ACCOUNT_TYPES),
  /** Asked to be a creator; identity check not passed yet. */
  creator_pending: z.boolean(),
  /** Made a creator by staff without an identity check. */
  creator_override: z.boolean().default(false),
});
export type AccountSummary = z.infer<typeof accountSummarySchema>;

export const accountSearchSchema = z.object({
  accounts: z.array(accountSummarySchema),
  pagination,
});
export type AccountSearch = z.infer<typeof accountSearchSchema>;

export const accountDetailSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  email_confirmed: z.boolean(),
  display_name: z.string().nullable(),
  created_at: z.string(),
  last_sign_in_at: z.string().nullable(),
  status: z.enum(ACCOUNT_STATUSES),
  account_type: z.enum(ACCOUNT_TYPES),
  creator_requested_at: z.string().nullable(),
  /** Identity check status word (never a Yoti id). */
  creator_check_status: z.string(),
  creator_override_at: z.string().nullish(),
  creator_override_by_email: z.string().nullish(),
  suspended_at: z.string().nullable(),
  suspended_until: z.string().nullable(),
  suspension_reason: z.string().nullable(),
  retired_at: z.string().nullable(),
  retire_reason: z.string().nullable(),
  retired_by_email: z.string().nullable(),
  /** Staff role the account lost when it was last retired (reactivating it needs manage_admins). */
  retired_staff_role: z.string().nullish(),
  staff_role: z.string().nullable(),
  age_verified: z.boolean(),
  active_sessions: z.number().int(),
  pending_transfers: z.number().int(),
  is_self: z.boolean(),
  /** Present only for admins who may delete (manage_admins). */
  delete: z.object({
    window_hours: z.number().int(),
    eligible_at: z.string().nullable(),
    blockers: z.array(z.string()),
  }).nullable(),
});
export type AccountDetail = z.infer<typeof accountDetailSchema>;

export const accountTokensSchema = z.object({
  tokens: z.array(z.object({
    id: z.string(),
    chip_name: z.string().nullable(),
    serial_suffix: z.string().nullable(),
    lifecycle_status: z.string().nullable(),
    registered_at: z.string().nullable(),
  })),
  reissue_requests: z.array(z.object({
    id: z.string(),
    tag_id: z.string(),
    status: z.string(),
    payment_status: z.string().nullable(),
    created_at: z.string(),
  })),
});
export type AccountTokens = z.infer<typeof accountTokensSchema>;

/** Action results vary by action; the page re-reads the account afterwards. */
export const actionResultSchema = z.record(z.unknown());

export const accountSettingsSchema = z.object({
  deleteWindowHours: z.number().int(),
  updatedAt: z.string(),
});
export type AccountSettings = z.infer<typeof accountSettingsSchema>;

export const auditLogSchema = z.object({
  log_id: z.string(),
  admin_id: z.string(),
  admin_email: z.string(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.string(),
  changes: z.unknown().nullable(),
  reason: z.string().nullable(),
  ip_address: z.string().nullable().optional(),
  created_at: z.string(),
});
export type AuditLogEntry = z.infer<typeof auditLogSchema>;

export const auditLogListSchema = z.object({
  logs: z.array(auditLogSchema),
  pagination,
});
export type AuditLogList = z.infer<typeof auditLogListSchema>;

export const auditFacetsSchema = z.object({
  actions: z.array(z.string()),
  entity_types: z.array(z.string()),
  actors: z.array(z.object({ admin_id: z.string(), email: z.string() })),
});
export type AuditFacets = z.infer<typeof auditFacetsSchema>;

/** Plain-language Delete blockers, matching the database function's keys. */
export const DELETE_BLOCKER_TEXT: Record<string, string> = {
  not_retired: 'The account has not been retired yet. Retire it first.',
  delete_window_open: 'The waiting time after retiring has not passed yet.',
  owns_tokens: 'The account still owns tokens. Transfer them to another account first.',
  created_tokens: 'The account created tokens, so it stays retired and cannot be deleted.',
  pending_transfer: 'The account has a transfer in progress. Wait for it to finish or cancel it first.',
  audit_actor: 'The account has taken staff actions, so it stays retired and cannot be deleted.',
  account_has_history: 'The account has payment or re-issue history, so it stays retired and cannot be deleted.',
};
