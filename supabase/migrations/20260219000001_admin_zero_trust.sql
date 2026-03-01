-- Migration: 20260219000001_admin_zero_trust.sql
-- Adds session_version to admin_users for token invalidation
-- Works alongside existing is_active boolean — no breaking changes

-- 1. session_version: unix timestamp
--    Tokens issued BEFORE this value are rejected even if the JWT itself is still valid.
--    Default 0 means all existing tokens remain valid — no disruption to Boss's current session.
ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS session_version BIGINT NOT NULL DEFAULT 0;

-- 2. Index for the hot query path (active admin lookup on every request)
CREATE INDEX IF NOT EXISTS idx_admin_users_active
  ON admin_users (admin_id)
  WHERE is_active = true;

-- 3. revoke_admin_session
--    Invalidates all active tokens without disabling the account.
--    Use when: suspected token leak, suspicious activity, forced re-login.
CREATE OR REPLACE FUNCTION revoke_admin_session(p_admin_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE admin_users
  SET session_version = EXTRACT(EPOCH FROM NOW())::BIGINT
  WHERE admin_id = p_admin_id
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin not found or inactive: %', p_admin_id;
  END IF;

  INSERT INTO audit_logs (
    admin_id, admin_email, action, entity_type, entity_id, reason, brand
  )
  SELECT
    p_admin_id,
    au.email,
    'session_revoked',
    'admin_user',
    p_admin_id,
    'Session invalidated — all active tokens rejected',
    'auctionx'
  FROM auth.users au WHERE au.id = p_admin_id;
END;
$$;

-- 4. deactivate_admin
--    Full access removal: is_active = false + bumps session_version.
--    Existing tokens immediately rejected. Must reactivate before logging in again.
CREATE OR REPLACE FUNCTION deactivate_admin(p_admin_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE admin_users
  SET
    is_active = false,
    session_version = EXTRACT(EPOCH FROM NOW())::BIGINT
  WHERE admin_id = p_admin_id
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin not found or already inactive: %', p_admin_id;
  END IF;

  INSERT INTO audit_logs (
    admin_id, admin_email, action, entity_type, entity_id, reason, brand
  )
  SELECT
    p_admin_id,
    au.email,
    'admin_deactivated',
    'admin_user',
    p_admin_id,
    COALESCE(p_reason, 'No reason provided'),
    'auctionx'
  FROM auth.users au WHERE au.id = p_admin_id;
END;
$$;

-- 5. reactivate_admin
--    Re-enables account AND bumps session_version — old tokens still dead.
--    Admin must log in fresh to get a new token.
CREATE OR REPLACE FUNCTION reactivate_admin(p_admin_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE admin_users
  SET
    is_active = true,
    session_version = EXTRACT(EPOCH FROM NOW())::BIGINT
  WHERE admin_id = p_admin_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin not found: %', p_admin_id;
  END IF;
END;
$$;

DO $$
BEGIN
  RAISE NOTICE '✓ Zero trust migration complete';
  RAISE NOTICE '✓ Added session_version to admin_users (default 0, non-breaking)';
  RAISE NOTICE '✓ Created: revoke_admin_session, deactivate_admin, reactivate_admin';
END $$;
