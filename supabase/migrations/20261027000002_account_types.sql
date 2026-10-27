-- =============================================================================
-- Account types: Collector / Creator (Boss, 2026-10-27)
-- =============================================================================
-- Every account is a Collector. An account becomes a Creator only when BOTH:
--   1. it asked to be one (sign-up choice or "Become a creator" in settings),
--      recorded as users.creator_requested_at, and
--   2. its identity check passed (seller_verification_status VERIFIED or
--      APPROVED, the same "already verified" set the Yoti controller uses).
--
-- users.account_type is written ONLY by the trigger below, from those two
-- facts. Nobody sets it directly: not users (the S-SEC column grant does not
-- include it), not staff, not backend code. Revoking a verification turns the
-- account back into a Collector; re-verifying restores Creator.
--
-- A Yoti check done for another purpose (age gate, Premier) never makes an
-- account a Creator, because it does not set creator_requested_at.
--
-- Staff is not an account type: it stays the staff role (admin_users).
-- Later types (Authenticator, Manufacturer, Partner) are deferred past MVP.
-- =============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'collector';
ALTER TABLE users ADD COLUMN IF NOT EXISTS creator_requested_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_account_type_chk
    CHECK (account_type IN ('collector', 'creator'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_users_account_type ON users(account_type);

-- ── Derive account_type ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION users_derive_account_type()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.account_type := CASE
    WHEN NEW.creator_requested_at IS NOT NULL
     AND NEW.seller_verification_status IN ('VERIFIED', 'APPROVED')
    THEN 'creator'
    ELSE 'collector'
  END;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION users_derive_account_type() FROM PUBLIC, anon, authenticated;

-- No column list on UPDATE: any write that touches account_type directly is
-- overwritten too.
DROP TRIGGER IF EXISTS users_derive_account_type_trg ON users;
CREATE TRIGGER users_derive_account_type_trg
  BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION users_derive_account_type();

-- ── Sign-up choice ───────────────────────────────────────────────────────────
-- The sign-up form passes account_intent = 'creator' in the auth metadata.
-- That metadata is user-controlled, which is fine: it only records the request;
-- Creator still needs a passed identity check.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, role, seller_tier, creator_requested_at)
  VALUES (
    NEW.id,
    NEW.email,
    'user',
    'TIER_1',
    CASE WHEN NEW.raw_user_meta_data ->> 'account_intent' = 'creator' THEN now() END
  );
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION handle_new_user() FROM PUBLIC, anon, authenticated;

-- ── "Become a creator" from settings ─────────────────────────────────────────
-- Called by the backend for the signed-in user (service role). Idempotent:
-- keeps the first request time. Returns the account's current type state.
CREATE OR REPLACE FUNCTION request_creator_account(p_user UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row users%ROWTYPE;
BEGIN
  UPDATE users
     SET creator_requested_at = coalesce(creator_requested_at, now())
   WHERE id = p_user
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  RETURN jsonb_build_object(
    'account_type', v_row.account_type,
    'creator_requested_at', v_row.creator_requested_at,
    'verification_status', v_row.seller_verification_status
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION request_creator_account(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION request_creator_account(UUID) TO service_role;

-- ── Backfill ─────────────────────────────────────────────────────────────────
-- Creator = already passed a Yoti identity check that was started as a creator
-- check (purpose seller_kyc or both). The legacy document pipeline (parked,
-- superseded by Yoti) does not count. Everyone else stays Collector.
UPDATE users u
   SET creator_requested_at = coalesce(u.seller_verification_reviewed_at, now())
 WHERE u.creator_requested_at IS NULL
   AND u.seller_verification_status IN ('VERIFIED', 'APPROVED')
   AND EXISTS (SELECT 1 FROM yoti_sessions s
                WHERE s.user_id = u.id
                  AND s.purpose IN ('seller_kyc', 'both')
                  AND s.status = 'completed');
-- No other row needs touching: the column is new, so every row without a
-- creator request is already 'collector' by default (and updated_at stays put).

-- ── Admin console: search with a type filter ─────────────────────────────────
-- New parameter p_type, so the old 5-argument version is dropped (an added
-- parameter would otherwise leave a second overload behind).
DROP FUNCTION IF EXISTS admin_search_accounts(UUID, TEXT, TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION admin_search_accounts(
  p_admin  UUID,
  p_query  TEXT,
  p_status TEXT,
  p_limit  INTEGER,
  p_offset INTEGER,
  p_type   TEXT DEFAULT 'all'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email  TEXT := admin_actor_email(p_admin, 'view_users');
  v_q      TEXT := btrim(coalesce(p_query, ''));
  v_like   TEXT;
  v_status TEXT := coalesce(nullif(p_status, ''), 'all');
  v_type   TEXT := coalesce(nullif(p_type, ''), 'all');
  v_limit  INTEGER := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset INTEGER := greatest(coalesce(p_offset, 0), 0);
  v_total  BIGINT;
  v_rows   JSONB;
BEGIN
  IF v_status NOT IN ('all', 'active', 'suspended', 'retired', 'staff') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'check_violation';
  END IF;
  IF v_type NOT IN ('all', 'collector', 'creator', 'creator_pending') THEN
    RAISE EXCEPTION 'invalid_type' USING ERRCODE = 'check_violation';
  END IF;
  IF length(v_q) > 254 THEN
    RAISE EXCEPTION 'query_too_long' USING ERRCODE = 'check_violation';
  END IF;
  IF v_q <> '' THEN
    INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, brand)
    VALUES (p_admin, v_email, 'user_search', 'admin_search', p_admin,
            jsonb_build_object('query', v_q, 'status', v_status, 'type', v_type, 'scope', 'users'), 'auctionx');
  END IF;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  WITH base AS (
    SELECT u.id,
           coalesce(au.email, u.email) AS email,
           u.display_name,
           u.created_at,
           au.last_sign_in_at,
           account_status_of(u.id) AS status,
           r.role_name AS staff_role,
           u.account_type,
           (u.account_type = 'collector' AND u.creator_requested_at IS NOT NULL) AS creator_pending
      FROM users u
      LEFT JOIN auth.users au ON au.id = u.id
      LEFT JOIN admin_users a ON a.admin_id = u.id AND a.is_active
      LEFT JOIN admin_roles r ON r.role_id = a.role_id
     WHERE (v_q = ''
            OR coalesce(au.email, u.email) ILIKE v_like
            OR u.display_name ILIKE v_like
            OR u.id::text = lower(v_q))
  ), filtered AS (
    SELECT * FROM base
     WHERE (v_status = 'all'
            OR (v_status = 'staff' AND staff_role IS NOT NULL)
            OR status = v_status)
       AND (v_type = 'all'
            OR (v_type = 'creator_pending' AND creator_pending)
            OR (v_type IN ('collector', 'creator') AND account_type = v_type))
  )
  SELECT (SELECT count(*) FROM filtered),
         coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.created_at DESC)
                     FROM (SELECT * FROM filtered ORDER BY created_at DESC LIMIT v_limit OFFSET v_offset) f), '[]'::jsonb)
    INTO v_total, v_rows;

  RETURN jsonb_build_object('total', v_total, 'accounts', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION admin_search_accounts(UUID, TEXT, TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_search_accounts(UUID, TEXT, TEXT, INTEGER, INTEGER, TEXT) TO service_role;

-- ── Admin console: account detail gains the type ─────────────────────────────
-- Same body as 20261025000003 plus account_type, creator_requested_at and the
-- identity check status (a status word, never a Yoti id).
CREATE OR REPLACE FUNCTION admin_get_account(p_admin UUID, p_target UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email     TEXT := admin_actor_email(p_admin, 'view_users');
  v_can_admin BOOLEAN;
  v_window    INTEGER;
  v_out       JSONB;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM admin_users a JOIN admin_roles r ON r.role_id = a.role_id
     WHERE a.admin_id = p_admin AND a.is_active AND 'manage_admins' = ANY (r.permissions::text[])
  ) INTO v_can_admin;
  SELECT delete_window_hours INTO v_window FROM account_settings WHERE id;

  SELECT jsonb_build_object(
           'id', u.id,
           'email', coalesce(au.email, u.email),
           'email_confirmed', au.email_confirmed_at IS NOT NULL,
           'display_name', u.display_name,
           'created_at', u.created_at,
           'last_sign_in_at', au.last_sign_in_at,
           'status', account_status_of(u.id),
           'account_type', u.account_type,
           'creator_requested_at', u.creator_requested_at,
           'creator_check_status', u.seller_verification_status,
           'suspended_at', u.suspended_at,
           'suspended_until', u.suspended_until,
           'suspension_reason', u.suspension_reason,
           'retired_at', u.retired_at,
           'retire_reason', u.retire_reason,
           'retired_by_email', (SELECT email FROM auth.users WHERE id = u.retired_by),
           'retired_staff_role', u.retired_role,
           'staff_role', (SELECT r.role_name FROM admin_users a JOIN admin_roles r ON r.role_id = a.role_id
                           WHERE a.admin_id = u.id AND a.is_active),
           'age_verified', coalesce(u.age_verified, false),
           'active_sessions', (SELECT count(*) FROM auth.sessions s WHERE s.user_id = u.id
                                 AND (s.not_after IS NULL OR s.not_after > now())),
           'pending_transfers', (SELECT count(*) FROM ownership_transfers t
                                  WHERE t.status = 'PENDING'
                                    AND (t.from_user_id = u.id OR t.to_user_id = u.id
                                         OR lower(t.to_email) = lower(coalesce(au.email, u.email)))),
           'is_self', u.id = p_admin,
           'delete', CASE WHEN v_can_admin THEN jsonb_build_object(
                       'window_hours', v_window,
                       'eligible_at', u.retired_at + make_interval(hours => coalesce(v_window, 24)),
                       'blockers', to_jsonb(account_delete_blockers(u.id)))
                     END
         )
    INTO v_out
    FROM users u
    LEFT JOIN auth.users au ON au.id = u.id
   WHERE u.id = p_target;

  IF v_out IS NULL THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION admin_get_account(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_get_account(UUID, UUID) TO service_role;
