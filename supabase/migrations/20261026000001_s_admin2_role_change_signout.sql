-- S-ADMIN2 follow-up (2026-10-26): revoking or changing a staff role signs the
-- account out everywhere.
--
-- Found in the live test: test2@ (support) stayed in the console after the role
-- was revoked. Every admin request was already refused (verifyAdminAuth needs an
-- active admin_users row; last_active_at stopped before the revoke), but the
-- browser kept showing the console. Now the revoke / change also ends every
-- session and refresh token (admin_end_sessions), as suspend and retire do, and
-- the console re-checks GET /admin/me and signs out when access is gone.
--
-- Only admin_set_account_role changes. Live checks: supabase/tests/s_admin2_accounts_live.sql (34).

CREATE OR REPLACE FUNCTION admin_set_account_role(p_admin UUID, p_target UUID, p_role TEXT, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locked  BOOLEAN := admin_lock_changes();
  v_email   TEXT := admin_actor_email(p_admin, 'manage_admins');
  v_reason  TEXT := admin_require_reason(p_reason);
  v_role    TEXT := nullif(btrim(coalesce(p_role, '')), '');
  v_status  TEXT;
  v_from    TEXT;
  v_role_id UUID;
  v_action  TEXT;
  v_ended   INTEGER := 0;
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
       SET is_active = false, session_version = floor(EXTRACT(EPOCH FROM now()))::BIGINT + 1
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

  -- Losing or changing a role signs the account out everywhere, like suspend
  -- and retire: no session keeps the access it was opened with. A grant does not.
  IF v_from IS NOT NULL THEN
    v_ended := admin_end_sessions(p_target);
  END IF;

  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, reason, brand)
  VALUES (p_admin, v_email, v_action, 'user', p_target,
          jsonb_build_object('from', v_from, 'to', v_role, 'sessions_ended', v_ended), v_reason, 'auctionx');

  RETURN jsonb_build_object('role', v_role, 'previous_role', v_from, 'sessions_ended', v_ended);
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_set_account_role(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_set_account_role(UUID, UUID, TEXT, TEXT) TO service_role;
