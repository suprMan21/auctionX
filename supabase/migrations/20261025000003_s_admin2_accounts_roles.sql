-- S-ADMIN2 Ph1 (2026-10-25): accounts, roles and one permission model.
--
-- Decisions (Boss, 2026-10-25):
--   * Account actions are Suspend (temporary) and Retire (step 1 of the Locked
--     two-step delete). Ban is dropped.
--   * admin_users is the only staff model. users.role is kept as a mirror by
--     admin_set_account_role and is not used for any new check.
--   * Grantable roles: super_admin, admin, support.
--   * Admin MFA (AAL2) is a backend flag, off until S-2FA.
--
-- Every function here is SECURITY DEFINER, service_role only, re-checks the
-- actor's PERMISSION itself, and writes exactly one audit_logs row. Suspend,
-- retire and delete touch auth.users / auth.sessions in the same transaction,
-- so the database and the sign-in system cannot disagree.
--
-- Live checks: supabase/tests/s_admin2_accounts_live.sql

-- ── 1. Columns and settings ─────────────────────────────────────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS retired_at    TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS retired_by    UUID;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS retire_reason TEXT;

COMMENT ON COLUMN public.users.retired_at IS
  'S-ADMIN2: set by admin_retire_account. Retired = cannot sign in; Delete is allowed only after account_settings.delete_window_hours.';

-- One row. The waiting window between Retire and Delete (Locked 2026-10-25:
-- default 24 h, super_admin may change it, never below 1 h).
CREATE TABLE IF NOT EXISTS public.account_settings (
  id                  BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  delete_window_hours INTEGER NOT NULL DEFAULT 24
                      CHECK (delete_window_hours >= 1 AND delete_window_hours <= 8760),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          UUID
);
INSERT INTO public.account_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.account_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.account_settings TO service_role;

-- ── 2. Role permissions ─────────────────────────────────────────────────────
-- admin: may suspend/retire plain accounts, run the payment queue, set prices.
-- support: may Re-apply stuck payments (was the role-name rule).
-- super_admin: everything.
UPDATE admin_roles
   SET permissions = (SELECT array_agg(DISTINCT p ORDER BY p)
                        FROM unnest(permissions || ARRAY['manage_users', 'reapply_payments', 'refund_token_fees', 'manage_pricing']::admin_permission[]) p)
 WHERE role_name IN ('admin', 'super_admin');

UPDATE admin_roles
   SET permissions = (SELECT array_agg(DISTINCT p ORDER BY p)
                        FROM unnest(permissions || ARRAY['reapply_payments']::admin_permission[]) p)
 WHERE role_name = 'support';

-- ── 3. Helpers ──────────────────────────────────────────────────────────────

-- Raises 42501 unless p_admin is an active admin whose role holds p_permission.
CREATE OR REPLACE FUNCTION admin_actor_email(p_admin UUID, p_permission TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT au.email INTO v_email
    FROM admin_users a
    JOIN admin_roles r ON r.role_id = a.role_id
    JOIN auth.users au ON au.id = a.admin_id
    JOIN users u ON u.id = a.admin_id
   WHERE a.admin_id = p_admin
     AND a.is_active
     AND u.retired_at IS NULL
     AND NOT (coalesce(u.is_suspended, false) AND (u.suspended_until IS NULL OR u.suspended_until > now()))
     AND coalesce(p_permission, '') = ANY (r.permissions::text[]);

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'admin_forbidden: actor lacks %', p_permission USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v_email;
END;
$$;

-- Same rule as before, now by permission: Re-apply = reapply_payments,
-- refund = refund_token_fees.
CREATE OR REPLACE FUNCTION payment_admin_actor_email(p_admin UUID, p_need_admin BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN admin_actor_email(
    p_admin,
    CASE WHEN coalesce(p_need_admin, true) THEN 'refund_token_fees' ELSE 'reapply_payments' END
  );
END;
$$;

-- 'retired' | 'suspended' | 'active'. A suspension past its end time is over.
CREATE OR REPLACE FUNCTION account_status_of(p_user UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
           WHEN u.retired_at IS NOT NULL THEN 'retired'
           WHEN coalesce(u.is_suspended, false)
                AND (u.suspended_until IS NULL OR u.suspended_until > now()) THEN 'suspended'
           ELSE 'active'
         END
    FROM users u
   WHERE u.id = p_user;
$$;

-- Ends every sign-in session and refresh token, and invalidates admin JWTs
-- (verifyAdminAuth rejects tokens issued before session_version).
CREATE OR REPLACE FUNCTION admin_end_sessions(p_user UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  DELETE FROM auth.sessions WHERE user_id = p_user;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM auth.refresh_tokens WHERE user_id = p_user::text;
  UPDATE admin_users SET session_version = EXTRACT(EPOCH FROM now())::BIGINT + 1 WHERE admin_id = p_user;
  RETURN v_n;
END;
$$;

-- Actor checks shared by every account action. Acting on a staff account
-- additionally needs manage_admins (super_admin only), and nobody acts on
-- their own account, so the last super_admin can never be locked out.
CREATE OR REPLACE FUNCTION admin_account_guard(p_admin UUID, p_target UUID, p_permission TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := admin_actor_email(p_admin, p_permission);
BEGIN
  IF p_target IS NULL THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_target = p_admin THEN
    RAISE EXCEPTION 'cannot_act_on_self' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM admin_users WHERE admin_id = p_target AND is_active) THEN
    PERFORM admin_actor_email(p_admin, 'manage_admins');
  END IF;
  RETURN v_email;
END;
$$;

CREATE OR REPLACE FUNCTION admin_require_reason(p_reason TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'check_violation';
  END IF;
  RETURN btrim(p_reason);
END;
$$;

-- Why an account cannot be deleted right now (empty = it can).
CREATE OR REPLACE FUNCTION account_delete_blockers(p_target UUID)
RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_u      users%ROWTYPE;
  v_email  TEXT;
  v_window INTEGER;
  v_out    TEXT[] := ARRAY[]::TEXT[];
BEGIN
  SELECT * INTO v_u FROM users WHERE id = p_target;
  IF NOT FOUND THEN
    RETURN ARRAY['account_not_found'];
  END IF;
  SELECT coalesce(au.email, v_u.email) INTO v_email FROM auth.users au WHERE au.id = p_target;
  v_email := coalesce(v_email, v_u.email);
  SELECT delete_window_hours INTO v_window FROM account_settings WHERE id;

  IF v_u.retired_at IS NULL THEN
    v_out := array_append(v_out, 'not_retired'::text);
  ELSIF v_u.retired_at > now() - make_interval(hours => coalesce(v_window, 24)) THEN
    v_out := array_append(v_out, 'delete_window_open'::text);
  END IF;
  -- Tokens must always have a live owner (transfer them first).
  IF EXISTS (SELECT 1 FROM nfc_tags WHERE current_owner_id = p_target) THEN
    v_out := array_append(v_out, 'owns_tokens'::text);
  END IF;
  -- nfc_tags.seller_id cascades on auth.users delete: never delete a creator.
  IF EXISTS (SELECT 1 FROM nfc_tags WHERE seller_id = p_target) THEN
    v_out := array_append(v_out, 'created_tokens'::text);
  END IF;
  IF EXISTS (SELECT 1 FROM ownership_transfers
              WHERE status = 'PENDING'
                AND (from_user_id = p_target OR to_user_id = p_target
                     OR (v_email IS NOT NULL AND lower(to_email) = lower(v_email)))) THEN
    v_out := array_append(v_out, 'pending_transfer'::text);
  END IF;
  -- Audit entries are never deleted; their actors stay retired permanently.
  IF EXISTS (SELECT 1 FROM audit_logs WHERE admin_id = p_target) THEN
    v_out := array_append(v_out, 'audit_actor'::text);
  END IF;
  -- Re-issue requests are payment records and would cascade away.
  IF EXISTS (SELECT 1 FROM reissue_requests WHERE requester_id = p_target) THEN
    v_out := array_append(v_out, 'account_has_history'::text);
  END IF;
  RETURN v_out;
END;
$$;

-- ── 4. Account actions ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_suspend_account(p_admin UUID, p_target UUID, p_hours INTEGER, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email  TEXT := admin_account_guard(p_admin, p_target, 'manage_users');
  v_reason TEXT := admin_require_reason(p_reason);
  v_u      users%ROWTYPE;
  v_until  TIMESTAMPTZ;
  v_ended  INTEGER;
  v_prev   TIMESTAMPTZ;
BEGIN
  IF coalesce(p_hours, 0) < 1 OR p_hours > 8760 THEN
    RAISE EXCEPTION 'invalid_duration' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_u FROM users WHERE id = p_target FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_u.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'account_retired' USING ERRCODE = 'check_violation';
  END IF;

  v_prev := CASE WHEN account_status_of(p_target) = 'suspended' THEN v_u.suspended_until END;
  v_until := now() + make_interval(hours => p_hours);
  UPDATE users
     SET is_suspended = true, suspended_at = now(), suspended_until = v_until,
         suspension_reason = v_reason, updated_at = now()
   WHERE id = p_target;
  UPDATE auth.users SET banned_until = v_until WHERE id = p_target;
  v_ended := admin_end_sessions(p_target);

  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, reason, brand)
  VALUES (p_admin, v_email, 'account_suspend', 'user', p_target,
          jsonb_build_object('hours', p_hours, 'suspended_until', v_until,
                             'replaced_until', v_prev,
                             'sessions_ended', v_ended),
          v_reason, 'auctionx');

  RETURN jsonb_build_object('status', 'suspended', 'suspended_until', v_until, 'sessions_ended', v_ended);
END;
$$;

CREATE OR REPLACE FUNCTION admin_unsuspend_account(p_admin UUID, p_target UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email  TEXT := admin_account_guard(p_admin, p_target, 'manage_users');
  v_reason TEXT := admin_require_reason(p_reason);
  v_u      users%ROWTYPE;
BEGIN
  SELECT * INTO v_u FROM users WHERE id = p_target FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_u.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'account_retired' USING ERRCODE = 'check_violation';
  END IF;
  IF account_status_of(p_target) <> 'suspended' THEN
    RAISE EXCEPTION 'not_suspended' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE users
     SET is_suspended = false, suspended_at = NULL, suspended_until = NULL,
         suspension_reason = NULL, updated_at = now()
   WHERE id = p_target;
  UPDATE auth.users SET banned_until = NULL WHERE id = p_target;

  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, reason, brand)
  VALUES (p_admin, v_email, 'account_unsuspend', 'user', p_target,
          jsonb_build_object('was_suspended_until', v_u.suspended_until, 'was_reason', v_u.suspension_reason),
          v_reason, 'auctionx');

  RETURN jsonb_build_object('status', 'active');
END;
$$;

-- Step 1 of removal: blocks sign-in, ends sessions, removes admin access.
-- Reversible with admin_reactivate_account (admin access is NOT restored).
CREATE OR REPLACE FUNCTION admin_retire_account(p_admin UUID, p_target UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email  TEXT := admin_account_guard(p_admin, p_target, 'manage_users');
  v_reason TEXT := admin_require_reason(p_reason);
  v_u      users%ROWTYPE;
  v_role   TEXT;
  v_ended  INTEGER;
  v_window INTEGER;
BEGIN
  SELECT * INTO v_u FROM users WHERE id = p_target FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_u.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_retired' USING ERRCODE = 'check_violation';
  END IF;

  SELECT r.role_name INTO v_role
    FROM admin_users a JOIN admin_roles r ON r.role_id = a.role_id
   WHERE a.admin_id = p_target AND a.is_active;

  UPDATE admin_users SET is_active = false WHERE admin_id = p_target;
  UPDATE users
     SET retired_at = now(), retired_by = p_admin, retire_reason = v_reason,
         role = 'user', updated_at = now()
   WHERE id = p_target;
  UPDATE auth.users SET banned_until = now() + interval '100 years' WHERE id = p_target;
  v_ended := admin_end_sessions(p_target);
  SELECT delete_window_hours INTO v_window FROM account_settings WHERE id;

  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, reason, brand)
  VALUES (p_admin, v_email, 'account_retire', 'user', p_target,
          jsonb_build_object('removed_role', v_role, 'sessions_ended', v_ended,
                             'delete_eligible_at', now() + make_interval(hours => coalesce(v_window, 24))),
          v_reason, 'auctionx');

  RETURN jsonb_build_object('status', 'retired', 'removed_role', v_role, 'sessions_ended', v_ended,
                            'delete_eligible_at', now() + make_interval(hours => coalesce(v_window, 24)));
END;
$$;

CREATE OR REPLACE FUNCTION admin_reactivate_account(p_admin UUID, p_target UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email  TEXT := admin_account_guard(p_admin, p_target, 'manage_users');
  v_reason TEXT := admin_require_reason(p_reason);
  v_u      users%ROWTYPE;
  v_status TEXT;
BEGIN
  SELECT * INTO v_u FROM users WHERE id = p_target FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_u.retired_at IS NULL THEN
    RAISE EXCEPTION 'not_retired' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE users SET retired_at = NULL, retired_by = NULL, retire_reason = NULL, updated_at = now()
   WHERE id = p_target;
  v_status := account_status_of(p_target);
  -- A suspension that is still running stays in force.
  UPDATE auth.users
     SET banned_until = CASE WHEN v_status = 'suspended' THEN v_u.suspended_until END
   WHERE id = p_target;

  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, reason, brand)
  VALUES (p_admin, v_email, 'account_reactivate', 'user', p_target,
          jsonb_build_object('was_retired_at', v_u.retired_at, 'was_reason', v_u.retire_reason, 'status', v_status),
          v_reason, 'auctionx');

  RETURN jsonb_build_object('status', v_status);
END;
$$;

-- Step 2 of removal: super_admin only, typed confirmation (the part of the
-- email before '@'), only after the waiting window, never while blocked.
-- Removes the profile row and the sign-in account together.
CREATE OR REPLACE FUNCTION admin_delete_account(p_admin UUID, p_target UUID, p_confirm TEXT, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email    TEXT := admin_account_guard(p_admin, p_target, 'manage_admins');
  v_reason   TEXT := admin_require_reason(p_reason);
  v_u        users%ROWTYPE;
  v_target   TEXT;
  v_blockers TEXT[];
BEGIN
  SELECT * INTO v_u FROM users WHERE id = p_target FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT email INTO v_target FROM auth.users WHERE id = p_target;
  v_target := coalesce(v_target, v_u.email);

  IF lower(btrim(coalesce(p_confirm, ''))) <> lower(split_part(coalesce(v_target, ''), '@', 1))
     OR coalesce(v_target, '') = '' THEN
    RAISE EXCEPTION 'confirm_mismatch' USING ERRCODE = 'check_violation';
  END IF;

  v_blockers := account_delete_blockers(p_target);
  IF cardinality(v_blockers) > 0 THEN
    RAISE EXCEPTION 'delete_blocked: %', array_to_string(v_blockers, ',') USING ERRCODE = 'check_violation';
  END IF;

  BEGIN
    DELETE FROM users WHERE id = p_target;
    DELETE FROM auth.users WHERE id = p_target;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'delete_blocked: account_has_history' USING ERRCODE = 'check_violation';
  END;

  -- entity_id is not a foreign key, so the row outlives the account. Only the
  -- email domain is kept: deletion is often a privacy request.
  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, reason, brand)
  VALUES (p_admin, v_email, 'account_delete', 'user', p_target,
          jsonb_build_object('email_domain', split_part(v_target, '@', 2),
                             'retired_at', v_u.retired_at, 'retire_reason', v_u.retire_reason),
          v_reason, 'auctionx');

  RETURN jsonb_build_object('status', 'deleted');
END;
$$;

-- Grant, change or revoke a staff role (NULL = revoke). super_admin only.
CREATE OR REPLACE FUNCTION admin_set_account_role(p_admin UUID, p_target UUID, p_role TEXT, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email   TEXT := admin_actor_email(p_admin, 'manage_admins');
  v_reason  TEXT := admin_require_reason(p_reason);
  v_role    TEXT := nullif(btrim(coalesce(p_role, '')), '');
  v_status  TEXT;
  v_from    TEXT;
  v_role_id UUID;
  v_action  TEXT;
BEGIN
  IF p_target IS NULL THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_target = p_admin THEN
    RAISE EXCEPTION 'cannot_act_on_self' USING ERRCODE = 'check_violation';
  END IF;
  IF v_role IS NOT NULL AND v_role NOT IN ('super_admin', 'admin', 'support') THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1 FROM users WHERE id = p_target FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_target) THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  v_status := account_status_of(p_target);
  IF v_role IS NOT NULL AND v_status <> 'active' THEN
    RAISE EXCEPTION 'account_%', v_status USING ERRCODE = 'check_violation';
  END IF;

  SELECT r.role_name INTO v_from
    FROM admin_users a JOIN admin_roles r ON r.role_id = a.role_id
   WHERE a.admin_id = p_target AND a.is_active;

  IF v_from IS NOT DISTINCT FROM v_role THEN
    RAISE EXCEPTION 'no_change' USING ERRCODE = 'check_violation';
  END IF;

  IF v_role IS NULL THEN
    UPDATE admin_users
       SET is_active = false, session_version = EXTRACT(EPOCH FROM now())::BIGINT + 1
     WHERE admin_id = p_target;
    v_action := 'role_revoke';
  ELSE
    SELECT role_id INTO v_role_id FROM admin_roles WHERE role_name = v_role;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION 'invalid_role' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO admin_users (admin_id, role_id, assigned_by, brand, is_active)
    VALUES (p_target, v_role_id, p_admin, 'both', true)
    ON CONFLICT (admin_id) DO UPDATE
      SET role_id = EXCLUDED.role_id, assigned_by = EXCLUDED.assigned_by, is_active = true;
    v_action := CASE WHEN v_from IS NULL THEN 'role_grant' ELSE 'role_change' END;
  END IF;

  -- Mirror only; nothing new reads users.role.
  UPDATE users SET role = coalesce(v_role, 'user')::user_role, updated_at = now() WHERE id = p_target;

  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, reason, brand)
  VALUES (p_admin, v_email, v_action, 'user', p_target,
          jsonb_build_object('from', v_from, 'to', v_role), v_reason, 'auctionx');

  RETURN jsonb_build_object('role', v_role, 'previous_role', v_from);
END;
$$;

CREATE OR REPLACE FUNCTION admin_set_delete_window(p_admin UUID, p_hours INTEGER, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email  TEXT := admin_actor_email(p_admin, 'manage_admins');
  v_reason TEXT := admin_require_reason(p_reason);
  v_prev   INTEGER;
BEGIN
  IF coalesce(p_hours, 0) < 1 OR p_hours > 8760 THEN
    RAISE EXCEPTION 'invalid_window' USING ERRCODE = 'check_violation';
  END IF;
  SELECT delete_window_hours INTO v_prev FROM account_settings WHERE id FOR UPDATE;
  IF v_prev = p_hours THEN
    RAISE EXCEPTION 'no_change' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE account_settings SET delete_window_hours = p_hours, updated_at = now(), updated_by = p_admin WHERE id;

  -- No single subject row: a fixed id stands for the settings record.
  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, reason, brand)
  VALUES (p_admin, v_email, 'delete_window_set', 'account_settings', '00000000-0000-0000-0000-000000000001',
          jsonb_build_object('from_hours', v_prev, 'to_hours', p_hours), v_reason, 'auctionx');

  RETURN jsonb_build_object('delete_window_hours', p_hours, 'previous_hours', v_prev);
END;
$$;

-- ── 5. Reads ────────────────────────────────────────────────────────────────

-- Search by email, display name or exact id. A non-empty search is
-- audit-logged first, in the same transaction (fails closed).
CREATE OR REPLACE FUNCTION admin_search_accounts(
  p_admin  UUID,
  p_query  TEXT,
  p_status TEXT,
  p_limit  INTEGER,
  p_offset INTEGER
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
  v_limit  INTEGER := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset INTEGER := greatest(coalesce(p_offset, 0), 0);
  v_total  BIGINT;
  v_rows   JSONB;
BEGIN
  IF v_status NOT IN ('all', 'active', 'suspended', 'retired', 'staff') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'check_violation';
  END IF;
  IF length(v_q) > 254 THEN
    RAISE EXCEPTION 'query_too_long' USING ERRCODE = 'check_violation';
  END IF;
  IF v_q <> '' THEN
    INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, brand)
    VALUES (p_admin, v_email, 'user_search', 'admin_search', p_admin,
            jsonb_build_object('query', v_q, 'status', v_status, 'scope', 'users'), 'auctionx');
  END IF;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  WITH base AS (
    SELECT u.id,
           coalesce(au.email, u.email) AS email,
           u.display_name,
           u.created_at,
           au.last_sign_in_at,
           account_status_of(u.id) AS status,
           r.role_name AS staff_role
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
     WHERE v_status = 'all'
        OR (v_status = 'staff' AND staff_role IS NOT NULL)
        OR status = v_status
  )
  SELECT (SELECT count(*) FROM filtered),
         coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.created_at DESC)
                     FROM (SELECT * FROM filtered ORDER BY created_at DESC LIMIT v_limit OFFSET v_offset) f), '[]'::jsonb)
    INTO v_total, v_rows;

  RETURN jsonb_build_object('total', v_total, 'accounts', v_rows);
END;
$$;

-- What support needs about one account. No Stripe/Yoti ids, no token list
-- (that is admin_get_account_tokens, manage_nfc + audited).
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
           'suspended_at', u.suspended_at,
           'suspended_until', u.suspended_until,
           'suspension_reason', u.suspension_reason,
           'retired_at', u.retired_at,
           'retire_reason', u.retire_reason,
           'retired_by_email', (SELECT email FROM auth.users WHERE id = u.retired_by),
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

-- Token holdings and re-issue history: manage_nfc, and the view itself is
-- audit-logged first (AC 4).
CREATE OR REPLACE FUNCTION admin_get_account_tokens(p_admin UUID, p_target UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := admin_actor_email(p_admin, 'manage_nfc');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_target) THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, brand)
  VALUES (p_admin, v_email, 'user_tokens_view', 'user', p_target, '{}'::jsonb, 'auctionx');

  RETURN jsonb_build_object(
    'tokens', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', t.id, 'chip_name', t.chip_name,
               'serial_suffix', right(t.chip_serial, 8),
               'lifecycle_status', t.lifecycle_status,
               'registered_at', t.registered_at) ORDER BY t.registered_at DESC NULLS LAST)
        FROM nfc_tags t WHERE t.current_owner_id = p_target), '[]'::jsonb),
    'reissue_requests', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', r.id, 'tag_id', r.tag_id, 'status', r.status,
               'payment_status', r.payment_status, 'created_at', r.created_at) ORDER BY r.created_at DESC)
        FROM reissue_requests r WHERE r.requester_id = p_target), '[]'::jsonb)
  );
END;
$$;

-- Values for the audit-log filter dropdowns.
CREATE OR REPLACE FUNCTION admin_audit_log_facets()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'actions',      coalesce((SELECT jsonb_agg(a ORDER BY a) FROM (SELECT DISTINCT action FROM audit_logs) x(a)), '[]'::jsonb),
    'entity_types', coalesce((SELECT jsonb_agg(e ORDER BY e) FROM (SELECT DISTINCT entity_type FROM audit_logs) y(e)), '[]'::jsonb),
    'actors',       coalesce((SELECT jsonb_agg(jsonb_build_object('admin_id', admin_id, 'email', admin_email) ORDER BY admin_email)
                                FROM (SELECT DISTINCT ON (admin_id) admin_id, admin_email FROM audit_logs ORDER BY admin_id, created_at DESC) z), '[]'::jsonb)
  );
$$;

-- ── 6. Legacy functions replaced (AC 10) ────────────────────────────────────
-- Each was audited twice (route middleware + function), recorded the target as
-- the actor (session/deactivate), or wrote nothing (reactivate). Only
-- backend/src/routes/admin/users.ts called them; it now uses the functions above.
DROP FUNCTION IF EXISTS public.suspend_user(uuid, integer, text, uuid);
DROP FUNCTION IF EXISTS public.unsuspend_user(uuid, uuid);
DROP FUNCTION IF EXISTS public.ban_user(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.unban_user(uuid, uuid);
DROP FUNCTION IF EXISTS public.deactivate_admin(uuid, text);
DROP FUNCTION IF EXISTS public.reactivate_admin(uuid);
DROP FUNCTION IF EXISTS public.revoke_admin_session(uuid);

-- ── 7. Grants: service_role only ────────────────────────────────────────────
REVOKE ALL ON FUNCTION admin_actor_email(UUID, TEXT)                              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION payment_admin_actor_email(UUID, BOOLEAN)                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION account_status_of(UUID)                                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_end_sessions(UUID)                                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_account_guard(UUID, UUID, TEXT)                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_require_reason(TEXT)                                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION account_delete_blockers(UUID)                              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_suspend_account(UUID, UUID, INTEGER, TEXT)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_unsuspend_account(UUID, UUID, TEXT)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_retire_account(UUID, UUID, TEXT)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_reactivate_account(UUID, UUID, TEXT)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_delete_account(UUID, UUID, TEXT, TEXT)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_set_account_role(UUID, UUID, TEXT, TEXT)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_set_delete_window(UUID, INTEGER, TEXT)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_search_accounts(UUID, TEXT, TEXT, INTEGER, INTEGER)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_get_account(UUID, UUID)                              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_get_account_tokens(UUID, UUID)                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_audit_log_facets()                                   FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION admin_actor_email(UUID, TEXT)                              TO service_role;
GRANT EXECUTE ON FUNCTION payment_admin_actor_email(UUID, BOOLEAN)                   TO service_role;
GRANT EXECUTE ON FUNCTION account_status_of(UUID)                                    TO service_role;
GRANT EXECUTE ON FUNCTION admin_end_sessions(UUID)                                   TO service_role;
GRANT EXECUTE ON FUNCTION admin_account_guard(UUID, UUID, TEXT)                      TO service_role;
GRANT EXECUTE ON FUNCTION admin_require_reason(TEXT)                                 TO service_role;
GRANT EXECUTE ON FUNCTION account_delete_blockers(UUID)                              TO service_role;
GRANT EXECUTE ON FUNCTION admin_suspend_account(UUID, UUID, INTEGER, TEXT)           TO service_role;
GRANT EXECUTE ON FUNCTION admin_unsuspend_account(UUID, UUID, TEXT)                  TO service_role;
GRANT EXECUTE ON FUNCTION admin_retire_account(UUID, UUID, TEXT)                     TO service_role;
GRANT EXECUTE ON FUNCTION admin_reactivate_account(UUID, UUID, TEXT)                 TO service_role;
GRANT EXECUTE ON FUNCTION admin_delete_account(UUID, UUID, TEXT, TEXT)               TO service_role;
GRANT EXECUTE ON FUNCTION admin_set_account_role(UUID, UUID, TEXT, TEXT)             TO service_role;
GRANT EXECUTE ON FUNCTION admin_set_delete_window(UUID, INTEGER, TEXT)               TO service_role;
GRANT EXECUTE ON FUNCTION admin_search_accounts(UUID, TEXT, TEXT, INTEGER, INTEGER)  TO service_role;
GRANT EXECUTE ON FUNCTION admin_get_account(UUID, UUID)                              TO service_role;
GRANT EXECUTE ON FUNCTION admin_get_account_tokens(UUID, UUID)                       TO service_role;
GRANT EXECUTE ON FUNCTION admin_audit_log_facets()                                   TO service_role;

-- ── 8. Pricing and vouchers: by permission (manage_pricing) ─────────────────
-- Bodies copied unchanged from 20261024000001 except the actor check.

CREATE OR REPLACE FUNCTION admin_set_token_price(
  p_admin          UUID,
  p_kind           TEXT,
  p_amount         INTEGER,
  p_effective_from TIMESTAMPTZ,
  p_reason         TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Raises unless p_admin holds manage_pricing (admin, super_admin).
  v_email     TEXT := admin_actor_email(p_admin, 'manage_pricing');
  v_effective TIMESTAMPTZ := coalesce(p_effective_from, now());
  v_previous  INTEGER := current_token_price(p_kind);
  v_row       token_prices%ROWTYPE;
BEGIN
  IF coalesce(p_kind, '') NOT IN ('transfer', 'token', 'reissue') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = 'check_violation';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'check_violation';
  END IF;
  -- No backdating. A minute of slack for clock skew between backend and DB.
  IF v_effective < now() - interval '1 minute' THEN
    RAISE EXCEPTION 'effective_in_past' USING ERRCODE = 'check_violation';
  END IF;
  IF v_effective < now() THEN
    v_effective := now();
  END IF;

  INSERT INTO token_prices (kind, amount_usd_cents, effective_from, reason, created_by)
  VALUES (p_kind, p_amount, v_effective, btrim(p_reason), p_admin)
  RETURNING * INTO v_row;

  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, reason, brand)
  VALUES (
    p_admin, v_email, 'token_price_set', 'token_price', v_row.id,
    jsonb_build_object(
      'kind', p_kind,
      'amount_usd_cents', p_amount,
      'previous_amount_usd_cents', v_previous,
      'effective_from', v_effective,
      'scheduled', v_effective > now()
    ),
    btrim(p_reason), 'auctionx'
  );

  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION admin_cancel_token_price(
  p_admin  UUID,
  p_price  UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := admin_actor_email(p_admin, 'manage_pricing');
  v_row   token_prices%ROWTYPE;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_row FROM token_prices WHERE id = p_price FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'price_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_row.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'price_already_cancelled' USING ERRCODE = 'check_violation';
  END IF;
  IF v_row.effective_from <= now() THEN
    RAISE EXCEPTION 'price_already_effective' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE token_prices
     SET cancelled_at = now(), cancelled_by = p_admin, cancel_reason = btrim(p_reason)
   WHERE id = p_price
  RETURNING * INTO v_row;

  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, reason, brand)
  VALUES (
    p_admin, v_email, 'token_price_cancel', 'token_price', p_price,
    jsonb_build_object(
      'kind', v_row.kind,
      'amount_usd_cents', v_row.amount_usd_cents,
      'effective_from', v_row.effective_from
    ),
    btrim(p_reason), 'auctionx'
  );

  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION admin_grant_transfer_vouchers(
  p_admin      UUID,
  p_user       UUID,
  p_quantity   INTEGER,
  p_reason     TEXT,
  p_expires_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := admin_actor_email(p_admin, 'manage_pricing');
  v_row   transfer_voucher_grants%ROWTYPE;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'check_violation';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 100 THEN
    RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = 'check_violation';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'expiry_in_past' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user) THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO transfer_voucher_grants (user_id, quantity, remaining, reason, expires_at, granted_by)
  VALUES (p_user, p_quantity, p_quantity, btrim(p_reason), p_expires_at, p_admin)
  RETURNING * INTO v_row;

  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, reason, brand)
  VALUES (
    p_admin, v_email, 'voucher_grant', 'transfer_voucher_grant', v_row.id,
    jsonb_build_object('user_id', p_user, 'quantity', p_quantity, 'expires_at', p_expires_at),
    btrim(p_reason), 'auctionx'
  );

  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION admin_revoke_transfer_voucher(
  p_admin  UUID,
  p_grant  UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := admin_actor_email(p_admin, 'manage_pricing');
  v_row   transfer_voucher_grants%ROWTYPE;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_row FROM transfer_voucher_grants WHERE id = p_grant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'grant_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_row.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'grant_already_revoked' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE transfer_voucher_grants
     SET revoked_at = now(), revoked_by = p_admin, revoke_reason = btrim(p_reason)
   WHERE id = p_grant
  RETURNING * INTO v_row;

  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, reason, brand)
  VALUES (
    p_admin, v_email, 'voucher_revoke', 'transfer_voucher_grant', p_grant,
    jsonb_build_object('user_id', v_row.user_id, 'quantity', v_row.quantity, 'unused', v_row.remaining),
    btrim(p_reason), 'auctionx'
  );

  RETURN to_jsonb(v_row);
END;
$$;
