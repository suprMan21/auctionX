/**
 * The signed-in admin's role and permissions, for showing or hiding admin UI
 * (S-ADMIN2 Ph1: one permission model). Display only: the API enforces every
 * permission itself.
 *
 * AdminProtectedRoute loads them from GET /admin/me and provides them here.
 * Unknown (still loading, or the lookup failed) hides anything gated.
 */

import { createContext, useContext } from 'react';

export type AdminAccessState =
  | { status: 'loading' }
  | { status: 'known'; role: string | null; permissions: readonly string[]; adminId?: string };

/** Kept as AdminRoleState for existing imports. */
export type AdminRoleState = AdminAccessState;

export const AdminRoleContext = createContext<AdminAccessState>({ status: 'loading' });

export const useAdminRole = (): AdminAccessState => useContext(AdminRoleContext);

/** Permission names (the admin_permission enum). */
export const PERMISSIONS = {
  viewUsers: 'view_users',
  manageUsers: 'manage_users',
  manageAdmins: 'manage_admins',
  viewAuditLogs: 'view_audit_logs',
  manageNfc: 'manage_nfc',
  reapplyPayments: 'reapply_payments',
  refundTokenFees: 'refund_token_fees',
  managePricing: 'manage_pricing',
  reviewSellers: 'review_sellers',
} as const;

export const hasPermission = (state: AdminAccessState, permission: string): boolean =>
  state.status === 'known' && state.permissions.includes(permission);
