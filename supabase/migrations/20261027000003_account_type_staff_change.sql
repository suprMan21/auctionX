-- =============================================================================
-- Account types: staff change + override (Boss, 2026-10-27)
-- =============================================================================
-- Staff with manage_creator_ids (super_admin, admin) can change an account's
-- type in the admin console:
--   * To Creator (baseline): records the creator request. The account is a
--     Creator at once if its identity check already passed; otherwise it shows
--     "Creator (verifying)" until the check passes.
--   * To Creator with override: Creator at once, no identity check. Recorded as
--     creator_override_at / creator_override_by and shown as "set by staff".
--   * To Collector: clears the request and any override.
-- Reason required, nobody acts on their own account, every change audit-logged.
-- =============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS creator_override_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS creator_override_by UUID;

-- An override always names who made it.
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_creator_override_by_chk
    CHECK ((creator_override_at IS NULL) = (creator_override_by IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Derive account_type: now also Creator when staff overrode ───────────────
CREATE OR REPLACE FUNCTION users_derive_account_type()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.account_type := CASE
    WHEN NEW.creator_override_at IS NOT NULL THEN 'creator'
    WHEN NEW.creator_requested_at IS NOT NULL
     AND NEW.seller_verification_status IN ('VERIFIED', 'APPROVED')
    THEN 'creator'
    ELSE 'collector'
  END;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION users_derive_account_type() FROM PUBLIC, anon, authenticated;

-- ── Staff change ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_set_account_type(
  p_admin    UUID,
  p_target   UUID,
  p_type     TEXT,
  p_override BOOLEAN,
  p_reason   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locked   BOOLEAN := admin_lock_changes();
  v_email    TEXT := admin_actor_email(p_admin, 'manage_creator_ids');
  v_reason   TEXT := admin_require_reason(p_reason);
  v_override BOOLEAN := coalesce(p_override, false);
  v_before   users%ROWTYPE;
  v_after    users%ROWTYPE;
BEGIN
  IF p_target IS NULL THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_target = p_admin THEN
    RAISE EXCEPTION 'cannot_act_on_self' USING ERRCODE = 'check_violation';
  END IF;
  IF coalesce(p_type, '') NOT IN ('collector', 'creator') THEN
    RAISE EXCEPTION 'invalid_type' USING ERRCODE = 'check_violation';
  END IF;
  IF p_type = 'collector' AND v_override THEN
    RAISE EXCEPTION 'invalid_type' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_before FROM users WHERE id = p_target FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  IF p_type = 'collector' THEN
    UPDATE users
       SET creator_requested_at = NULL, creator_override_at = NULL, creator_override_by = NULL
     WHERE id = p_target
    RETURNING * INTO v_after;
  ELSIF v_override THEN
    UPDATE users
       SET creator_requested_at = coalesce(creator_requested_at, now()),
           creator_override_at  = coalesce(creator_override_at, now()),
           creator_override_by  = coalesce(creator_override_by, p_admin)
     WHERE id = p_target
    RETURNING * INTO v_after;
  ELSE
    UPDATE users
       SET creator_requested_at = coalesce(creator_requested_at, now())
     WHERE id = p_target
    RETURNING * INTO v_after;
  END IF;

  IF v_after.account_type IS NOT DISTINCT FROM v_before.account_type
     AND (v_after.creator_requested_at IS NULL) = (v_before.creator_requested_at IS NULL)
     AND (v_after.creator_override_at IS NULL) = (v_before.creator_override_at IS NULL) THEN
    RAISE EXCEPTION 'no_change' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, reason, brand)
  VALUES (p_admin, v_email, 'account_type_change', 'user', p_target,
          jsonb_build_object(
            'from', v_before.account_type,
            'to', v_after.account_type,
            'override', v_after.creator_override_at IS NOT NULL,
            'creator_pending', v_after.account_type = 'collector' AND v_after.creator_requested_at IS NOT NULL,
            'creator_check_status', v_after.seller_verification_status),
          v_reason, 'auctionx');

  RETURN jsonb_build_object(
    'account_type', v_after.account_type,
    'previous_type', v_before.account_type,
    'creator_pending', v_after.account_type = 'collector' AND v_after.creator_requested_at IS NOT NULL,
    'override', v_after.creator_override_at IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION admin_set_account_type(UUID, UUID, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_set_account_type(UUID, UUID, TEXT, BOOLEAN, TEXT) TO service_role;

-- ── Admin reads: show the override ───────────────────────────────────────────
-- Search: one extra output column (creator_override). Same body as
-- 20261027000002 otherwise.
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
           (u.account_type = 'collector' AND u.creator_requested_at IS NOT NULL) AS creator_pending,
           (u.creator_override_at IS NOT NULL) AS creator_override
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

-- Detail: wrap the 20261027000002 version and add the override facts, so the
-- long body is not copied a third time.
DO $$ BEGIN
  IF to_regprocedure('public.admin_get_account_base(uuid, uuid)') IS NULL THEN
    ALTER FUNCTION admin_get_account(UUID, UUID) RENAME TO admin_get_account_base;
  END IF;
END $$;

REVOKE ALL ON FUNCTION admin_get_account_base(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_get_account_base(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION admin_get_account(p_admin UUID, p_target UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_out JSONB := admin_get_account_base(p_admin, p_target);
BEGIN
  RETURN v_out || (
    SELECT jsonb_build_object(
             'creator_override_at', u.creator_override_at,
             'creator_override_by_email', (SELECT email FROM auth.users WHERE id = u.creator_override_by))
      FROM users u WHERE u.id = p_target);
END;
$$;

REVOKE ALL ON FUNCTION admin_get_account(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_get_account(UUID, UUID) TO service_role;
