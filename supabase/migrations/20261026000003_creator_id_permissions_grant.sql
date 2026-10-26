-- Creator ID checks access (Boss 2026-10-26), part 2: grant the permissions.
--   view_creator_ids   -> super_admin, admin, support (open the list + detail)
--   manage_creator_ids -> super_admin, admin          (change a status)
-- Idempotent (no duplicates on re-run). Live checks:
-- supabase/tests/creator_id_permissions_live.sql

UPDATE admin_roles
   SET permissions = (SELECT array_agg(DISTINCT p ORDER BY p)
                        FROM unnest(permissions || ARRAY['view_creator_ids', 'manage_creator_ids']::admin_permission[]) p)
 WHERE role_name IN ('super_admin', 'admin');

UPDATE admin_roles
   SET permissions = (SELECT array_agg(DISTINCT p ORDER BY p)
                        FROM unnest(permissions || ARRAY['view_creator_ids']::admin_permission[]) p)
 WHERE role_name = 'support';
