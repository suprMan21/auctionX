/**
 * S-ADMIN2 Ph1 — the one admin permission model (AC 9).
 *
 * Every admin gate checks a PERMISSION held by the admin's role, never the
 * role name. The database functions re-check the same permission, so a route
 * gate is the first check, not the only one. Values match the
 * `admin_permission` enum (migrations 20261025000002/3).
 */

export const PERMISSIONS = {
  viewUsers: 'view_users',
  manageUsers: 'manage_users',
  manageAdmins: 'manage_admins',
  viewAuditLogs: 'view_audit_logs',
  manageNfc: 'manage_nfc',
  reapplyPayments: 'reapply_payments',
  refundTokenFees: 'refund_token_fees',
  managePricing: 'manage_pricing',
  /** Creator ID checks (Yoti): open the list and detail / change a status (2026-10-26). */
  viewCreatorIds: 'view_creator_ids',
  manageCreatorIds: 'manage_creator_ids',
  /** Parked marketplace seller approvals only (super_admin). */
  reviewSellers: 'review_sellers',
  // Parked marketplace (routes mounted only when the marketplace flag is on).
  viewListings: 'view_listings',
  moderateListings: 'moderate_listings',
  viewPayments: 'view_payments',
  processRefunds: 'process_refunds',
  viewAnalytics: 'view_analytics',
  manageEscrow: 'manage_escrow',
} as const;

export type AdminPermission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Roles a super_admin may grant (Boss 2026-10-25). Others stay in the table, unused. */
export const GRANTABLE_ROLES = ['super_admin', 'admin', 'support'] as const;
export type GrantableRole = (typeof GRANTABLE_ROLES)[number];

export const hasPermission = (
  admin: { permissions?: readonly string[] } | undefined,
  permission: AdminPermission,
): boolean => !!admin?.permissions?.includes(permission);
