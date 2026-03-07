-- Migration: 20260307000001_fix_admin_users_rls_recursion.sql
-- Fixes infinite recursion in admin_users RLS policies.
-- The "Super admins can view all admins" and "Super admins can manage admins"
-- policies query admin_users from within admin_users RLS, causing a circular dependency.
-- Fix: Use a SECURITY DEFINER function that bypasses RLS to check admin permissions.

-- 1. Create a helper function that bypasses RLS to check if a user has a specific permission
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
      AND p_permission = ANY(ar.permissions)
  );
END;
$$;

-- 2. Create a simpler helper to check if user is an active admin (no permission check)
CREATE OR REPLACE FUNCTION public.is_active_admin(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM admin_users
    WHERE admin_id = p_user_id
      AND is_active = true
  );
END;
$$;

-- 3. Drop the recursive policies on admin_users
DROP POLICY IF EXISTS "Super admins can view all admins" ON admin_users;
DROP POLICY IF EXISTS "Super admins can manage admins" ON admin_users;

-- 4. Recreate them using the SECURITY DEFINER helper
CREATE POLICY "Super admins can view all admins"
  ON admin_users FOR SELECT
  USING (
    public.is_admin_with_permission(auth.uid(), 'manage_admins')
  );

CREATE POLICY "Super admins can manage admins"
  ON admin_users FOR ALL
  USING (
    public.is_admin_with_permission(auth.uid(), 'manage_admins')
  );

-- 5. Also fix admin_roles policy which has the same recursion issue
DROP POLICY IF EXISTS "Admins can view roles" ON admin_roles;

CREATE POLICY "Admins can view roles"
  ON admin_roles FOR SELECT
  USING (
    public.is_active_admin(auth.uid())
  );

DO $$
BEGIN
  RAISE NOTICE '✓ Fixed admin_users RLS infinite recursion';
  RAISE NOTICE '✓ Created SECURITY DEFINER helpers: is_admin_with_permission, is_active_admin';
  RAISE NOTICE '✓ Recreated 3 policies using non-recursive helpers';
END $$;
