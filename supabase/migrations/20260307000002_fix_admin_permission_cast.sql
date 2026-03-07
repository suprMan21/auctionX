-- Migration: 20260307000002_fix_admin_permission_cast.sql
-- Fixes type mismatch in is_admin_with_permission: TEXT vs admin_permission enum

CREATE OR REPLACE FUNCTION public.is_admin_with_permission(p_user_id UUID, p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM admin_users au
    JOIN admin_roles ar ON au.role_id = ar.role_id
    WHERE au.admin_id = p_user_id
      AND au.is_active = true
      AND p_permission = ANY(ar.permissions::text[])
  );
END;
$$;
