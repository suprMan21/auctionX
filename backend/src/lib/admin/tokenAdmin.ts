/**
 * S-ADMIN1 — the single authorization rule for token administration.
 *
 * A token admin is an ACTIVE `admin_users` row whose role carries `manage_nfc`.
 * This replaces the old `users.role IN ('admin','super_admin')` staff check, so
 * the NFC routes and the admin console share one source of truth (they used to
 * disagree). The admin-console routes get the same rule via
 * verifyAdminAuth + requirePermission(MANAGE_NFC); this helper serves the
 * routes that live under /api/v1/nfc and use plain requireAuth (enroll and the
 * encoder precheck).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const MANAGE_NFC = 'manage_nfc';

/**
 * Fails closed: any lookup error, inactive row or missing role is "no".
 * Two plain reads rather than an embed, so it cannot be fooled by a missing FK
 * relationship in the PostgREST schema cache.
 */
export const hasManageNfc = async (supabase: SupabaseClient, userId: string): Promise<boolean> => {
  const { data: admin, error: adminError } = await supabase
    .from('admin_users')
    .select('role_id, is_active')
    .eq('admin_id', userId)
    .maybeSingle();

  if (adminError || !admin || admin.is_active !== true || !admin.role_id) return false;

  const { data: role, error: roleError } = await supabase
    .from('admin_roles')
    .select('permissions')
    .eq('role_id', admin.role_id)
    .maybeSingle();

  if (roleError || !role) return false;
  const permissions = (role.permissions as string[] | null) ?? [];
  return permissions.includes(MANAGE_NFC);
};
