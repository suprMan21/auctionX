/**
 * Role -> permission sets as seeded in the database after S-ADMIN2 Ph1, for
 * tests that render admin UI as a given role.
 */
import type { AdminAccessState } from '../lib/adminRole';

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  super_admin: [
    'view_users', 'manage_users', 'view_listings', 'moderate_listings', 'view_payments', 'process_refunds',
    'view_analytics', 'manage_admins', 'view_audit_logs', 'review_sellers', 'manage_escrow', 'manage_nfc',
    'reapply_payments', 'refund_token_fees', 'manage_pricing', 'view_creator_ids', 'manage_creator_ids',
    'act_without_approval',
  ],
  admin: ['manage_creator_ids', 'manage_nfc', 'manage_pricing', 'manage_users', 'reapply_payments', 'refund_token_fees', 'view_audit_logs', 'view_creator_ids', 'view_users'],
  support: ['process_refunds', 'reapply_payments', 'view_creator_ids', 'view_listings', 'view_payments', 'view_users'],
};

export const accessFor = (role: string | null, adminId = 'admin-self', approvalRequired = false): AdminAccessState => ({
  status: 'known',
  role,
  permissions: ROLE_PERMISSIONS[role ?? ''] ?? [],
  adminId,
  approvalRequired,
});
