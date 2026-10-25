/**
 * Role -> permission sets as seeded in the database after S-ADMIN2 Ph1
 * (20260202000001, 20261005000002, 20261025000003). Tests build `req.admin`
 * from these so route gates see what production sees.
 */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  super_admin: [
    'view_users', 'manage_users', 'view_listings', 'moderate_listings', 'view_payments', 'process_refunds',
    'view_analytics', 'manage_admins', 'view_audit_logs', 'review_sellers', 'manage_escrow', 'manage_nfc',
    'reapply_payments', 'refund_token_fees', 'manage_pricing',
  ],
  admin: ['manage_nfc', 'manage_pricing', 'manage_users', 'reapply_payments', 'refund_token_fees', 'view_audit_logs', 'view_users'],
  support: ['process_refunds', 'reapply_payments', 'view_listings', 'view_payments', 'view_users'],
  moderator: ['view_users', 'view_listings', 'moderate_listings', 'view_payments'],
  analyst: ['view_users', 'view_listings', 'view_payments', 'view_analytics', 'view_audit_logs'],
};

export const permissionsFor = (role: string | null | undefined): string[] => [...(ROLE_PERMISSIONS[role ?? ''] ?? [])];
