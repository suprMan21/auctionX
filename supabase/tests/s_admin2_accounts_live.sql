-- S-ADMIN2 Ph1 — live checks for 20261025000002/3 (accounts, roles, permissions).
--
-- Leaves NOTHING behind: one DO block that ends by raising an exception with
-- the results, so every change (including auth.users / auth.sessions writes
-- and the throwaway account) rolls back.
--
-- Run: supabase db query --linked -f supabase/tests/s_admin2_accounts_live.sql
-- Expect: ERROR  P0001: RESULTS {"ok": 34, "total": 34, "failures": {}}

DO $$
DECLARE
  v_super  CONSTANT UUID := '2b3f1532-9345-4720-8fac-55d07517c78b';  -- super_admin
  v_user   CONSTANT UUID := '0b211aed-3cf9-4729-818d-f0ed88dd68b8';  -- test@ (owns chip_004)
  v_staff  CONSTANT UUID := '885d30e1-4322-49a8-8363-b7926991c58d';  -- test2@ (made admin/support here)
  v_temp   CONSTANT UUID := 'a2a2a2a2-0000-4000-8000-00000000a2a2';  -- throwaway account
  v_temp_email CONSTANT TEXT := 's-admin2-live@example.invalid';
  v_fns    CONSTANT TEXT[] := ARRAY[
    'public.admin_actor_email(uuid, text)',
    'public.admin_lock_changes()',
    'public.payment_admin_actor_email(uuid, boolean)',
    'public.account_status_of(uuid)',
    'public.admin_end_sessions(uuid)',
    'public.admin_account_guard(uuid, uuid, text)',
    'public.admin_require_reason(text)',
    'public.account_delete_blockers(uuid)',
    'public.admin_suspend_account(uuid, uuid, integer, text)',
    'public.admin_unsuspend_account(uuid, uuid, text)',
    'public.admin_retire_account(uuid, uuid, text)',
    'public.admin_reactivate_account(uuid, uuid, text)',
    'public.admin_delete_account(uuid, uuid, text, text)',
    'public.admin_set_account_role(uuid, uuid, text, text)',
    'public.admin_set_delete_window(uuid, integer, text)',
    'public.admin_search_accounts(uuid, text, text, integer, integer)',
    'public.admin_get_account(uuid, uuid)',
    'public.admin_get_account_tokens(uuid, uuid)',
    'public.admin_audit_log_facets()',
    'public.admin_set_token_price(uuid, text, integer, timestamp with time zone, text)',
    'public.admin_cancel_token_price(uuid, uuid, text)',
    'public.admin_grant_transfer_vouchers(uuid, uuid, integer, text, timestamp with time zone)',
    'public.admin_revoke_transfer_voucher(uuid, uuid, text)'];
  v_legacy CONSTANT TEXT[] := ARRAY[
    'public.suspend_user(uuid, integer, text, uuid)', 'public.unsuspend_user(uuid, uuid)',
    'public.ban_user(uuid, text, uuid)', 'public.unban_user(uuid, uuid)',
    'public.deactivate_admin(uuid, text)', 'public.reactivate_admin(uuid)',
    'public.revoke_admin_session(uuid)'];
  R        CONSTANT TEXT := 'live check reason text';
  v_fn     TEXT;
  v_ok     BOOLEAN;
  v_n      BIGINT;
  v_j      JSONB;
  v_t      TEXT;
  v_state  TEXT;
  v_res    JSONB := '{}'::jsonb;

  -- Runs a statement, returns 'ok' or SQLSTATE + message.
  -- (inline blocks below; plpgsql has no closures)
BEGIN
  -- 01. New functions: service_role only.
  v_ok := true; v_t := '';
  FOREACH v_fn IN ARRAY v_fns LOOP
    IF to_regprocedure(v_fn) IS NULL
       OR has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      v_ok := false; v_t := v_t || ' ' || v_fn;
    END IF;
  END LOOP;
  v_res := v_res || jsonb_build_object('01_functions_service_only', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' || v_t END);

  -- 02. Legacy suspend/ban/admin-session functions are gone.
  v_ok := true;
  FOREACH v_fn IN ARRAY v_legacy LOOP
    v_ok := v_ok AND to_regprocedure(v_fn) IS NULL;
  END LOOP;
  v_res := v_res || jsonb_build_object('02_legacy_dropped', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 03. Role permissions.
  SELECT bool_and(CASE role_name
           WHEN 'admin' THEN permissions::text[] @> ARRAY['manage_users','reapply_payments','refund_token_fees','manage_pricing','manage_nfc','view_users']
                         AND NOT permissions::text[] && ARRAY['manage_admins']
           WHEN 'support' THEN permissions::text[] @> ARRAY['reapply_payments','view_users']
                         AND NOT permissions::text[] && ARRAY['refund_token_fees','manage_pricing','manage_users','manage_nfc']
           WHEN 'super_admin' THEN permissions::text[] @> ARRAY['manage_admins','manage_users','reapply_payments','refund_token_fees','manage_pricing','manage_nfc']
           ELSE true END)
    INTO v_ok FROM admin_roles;
  v_res := v_res || jsonb_build_object('03_role_permissions', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 04. account_settings: no client access; CHECK refuses < 1 h.
  v_ok := NOT has_table_privilege('anon', 'public.account_settings', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.account_settings', 'SELECT')
      AND (SELECT delete_window_hours FROM account_settings WHERE id) = 24;
  v_state := 'none';
  BEGIN UPDATE account_settings SET delete_window_hours = 0 WHERE id;
  EXCEPTION WHEN check_violation THEN v_state := '23514'; END;
  v_res := v_res || jsonb_build_object('04_settings_locked_default_24_min_1',
    CASE WHEN v_ok AND v_state = '23514' THEN 'ok' ELSE 'FAIL ' || v_ok || ' ' || v_state END);

  -- 05. super_admin grants test2 'admin': admin_users active, users.role mirrored, one audit row.
  PERFORM admin_set_account_role(v_super, v_staff, 'admin', R);
  SELECT count(*) INTO v_n FROM audit_logs WHERE entity_id = v_staff AND action = 'role_grant' AND created_at = now();
  v_ok := EXISTS (SELECT 1 FROM admin_users a JOIN admin_roles r USING (role_id)
                   WHERE a.admin_id = v_staff AND a.is_active AND r.role_name = 'admin')
      AND (SELECT role::text FROM users WHERE id = v_staff) = 'admin' AND v_n = 1;
  v_res := v_res || jsonb_build_object('05_role_grant', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL audit=' || v_n END);

  -- 06. An admin cannot grant roles (no self-elevation path).
  v_state := 'none';
  BEGIN PERFORM admin_set_account_role(v_staff, v_user, 'super_admin', R);
  EXCEPTION WHEN insufficient_privilege THEN v_state := '42501'; END;
  BEGIN PERFORM admin_set_account_role(v_staff, v_staff, 'super_admin', R);
  EXCEPTION WHEN insufficient_privilege THEN v_state := v_state || '+42501'; END;
  v_res := v_res || jsonb_build_object('06_admin_cannot_set_roles', CASE WHEN v_state = '42501+42501' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 07. Nobody acts on their own account.
  v_state := 'none';
  BEGIN PERFORM admin_set_account_role(v_super, v_super, NULL, R);
  EXCEPTION WHEN check_violation THEN v_state := SQLERRM; END;
  v_res := v_res || jsonb_build_object('07_no_self_role_change', CASE WHEN v_state = 'cannot_act_on_self' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 08. Reason is required.
  v_state := 'none';
  BEGIN PERFORM admin_suspend_account(v_staff, v_user, 24, 'short');
  EXCEPTION WHEN check_violation THEN v_state := SQLERRM; END;
  v_res := v_res || jsonb_build_object('08_reason_required', CASE WHEN v_state = 'reason_required' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 09. Admin suspends test@: status, sign-in ban, sessions gone, one audit row.
  v_j := admin_suspend_account(v_staff, v_user, 24, R);
  SELECT count(*) INTO v_n FROM audit_logs WHERE entity_id = v_user AND action = 'account_suspend' AND created_at = now();
  v_ok := account_status_of(v_user) = 'suspended'
      AND (SELECT banned_until FROM auth.users WHERE id = v_user) > now() + interval '23 hours'
      AND NOT EXISTS (SELECT 1 FROM auth.sessions WHERE user_id = v_user)
      AND v_n = 1;
  v_res := v_res || jsonb_build_object('09_suspend', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || v_j::text || ' audit=' || v_n END);

  -- 10. Admin cannot act on a staff account (needs manage_admins).
  v_state := 'none';
  BEGIN PERFORM admin_suspend_account(v_staff, v_super, 1, R);
  EXCEPTION WHEN insufficient_privilege THEN v_state := '42501'; END;
  v_res := v_res || jsonb_build_object('10_admin_cannot_touch_staff', CASE WHEN v_state = '42501' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 11. A suspended admin loses admin powers immediately.
  PERFORM admin_suspend_account(v_super, v_staff, 1, R);
  v_state := 'none';
  BEGIN PERFORM admin_unsuspend_account(v_staff, v_user, R);
  EXCEPTION WHEN insufficient_privilege THEN v_state := '42501'; END;
  PERFORM admin_unsuspend_account(v_super, v_staff, R);
  v_res := v_res || jsonb_build_object('11_suspended_admin_powerless', CASE WHEN v_state = '42501' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 12. Unsuspend: active, sign-in ban lifted, one audit row.
  PERFORM admin_unsuspend_account(v_staff, v_user, R);
  SELECT count(*) INTO v_n FROM audit_logs WHERE entity_id = v_user AND action = 'account_unsuspend' AND created_at = now();
  v_ok := account_status_of(v_user) = 'active'
      AND (SELECT banned_until FROM auth.users WHERE id = v_user) IS NULL AND v_n = 1;
  v_res := v_res || jsonb_build_object('12_unsuspend', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL audit=' || v_n END);

  -- 13. An expired suspension counts as active.
  UPDATE users SET is_suspended = true, suspended_until = now() - interval '1 minute' WHERE id = v_user;
  v_ok := account_status_of(v_user) = 'active';
  UPDATE users SET is_suspended = false, suspended_until = NULL WHERE id = v_user;
  v_res := v_res || jsonb_build_object('13_expired_suspension_is_active', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 14. Retire test@: retired, long ban, one audit row; Delete blocked (window + tokens).
  PERFORM admin_retire_account(v_staff, v_user, R);
  SELECT count(*) INTO v_n FROM audit_logs WHERE entity_id = v_user AND action = 'account_retire' AND created_at = now();
  v_ok := account_status_of(v_user) = 'retired'
      AND (SELECT banned_until FROM auth.users WHERE id = v_user) > now() + interval '99 years' AND v_n = 1;
  v_state := 'none';
  BEGIN PERFORM admin_delete_account(v_super, v_user, 'test', R);
  EXCEPTION WHEN check_violation THEN v_state := SQLERRM; END;
  v_res := v_res || jsonb_build_object('14_retire_then_delete_blocked',
    CASE WHEN v_ok AND v_state LIKE 'delete_blocked:%delete_window_open%' AND v_state LIKE '%owns_tokens%'
         THEN 'ok' ELSE 'FAIL ' || v_ok || ' ' || v_state END);

  -- 15. Reactivate: active, ban lifted, one audit row.
  PERFORM admin_reactivate_account(v_staff, v_user, R);
  SELECT count(*) INTO v_n FROM audit_logs WHERE entity_id = v_user AND action = 'account_reactivate' AND created_at = now();
  v_ok := account_status_of(v_user) = 'active'
      AND (SELECT banned_until FROM auth.users WHERE id = v_user) IS NULL AND v_n = 1;
  v_res := v_res || jsonb_build_object('15_reactivate', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL audit=' || v_n END);

  -- 16. Retiring a staff account removes admin access and the users.role mirror.
  v_j := admin_retire_account(v_super, v_staff, R);
  v_ok := v_j->>'removed_role' = 'admin'
      AND NOT EXISTS (SELECT 1 FROM admin_users WHERE admin_id = v_staff AND is_active)
      AND (SELECT role::text FROM users WHERE id = v_staff) = 'user';
  PERFORM admin_reactivate_account(v_super, v_staff, R);
  v_ok := v_ok AND NOT EXISTS (SELECT 1 FROM admin_users WHERE admin_id = v_staff AND is_active);
  v_res := v_res || jsonb_build_object('16_retire_staff_drops_access', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || v_j::text END);
  PERFORM admin_set_account_role(v_super, v_staff, 'admin', R);

  -- 17. Delete window setting: min 1 h, audited.
  v_state := 'none';
  BEGIN PERFORM admin_set_delete_window(v_super, 0, R);
  EXCEPTION WHEN check_violation THEN v_state := SQLERRM; END;
  BEGIN PERFORM admin_set_delete_window(v_staff, 48, R);
  EXCEPTION WHEN insufficient_privilege THEN v_state := v_state || '+42501'; END;
  PERFORM admin_set_delete_window(v_super, 48, R);
  SELECT count(*) INTO v_n FROM audit_logs WHERE action = 'delete_window_set' AND created_at = now();
  v_ok := (SELECT delete_window_hours FROM account_settings WHERE id) = 48 AND v_n = 1;
  v_res := v_res || jsonb_build_object('17_delete_window', CASE WHEN v_ok AND v_state = 'invalid_window+42501' THEN 'ok' ELSE 'FAIL ' || v_state || ' audit=' || v_n END);

  -- 18. Full delete on a throwaway account.
  INSERT INTO auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at)
  VALUES (v_temp, v_temp_email, 'authenticated', 'authenticated', now(), now(), now());
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_temp) THEN
    INSERT INTO users (id, email) VALUES (v_temp, v_temp_email);
  END IF;
  PERFORM admin_retire_account(v_staff, v_temp, R);
  UPDATE users SET retired_at = now() - interval '25 hours' WHERE id = v_temp;
  v_t := '';
  -- window is 48 h now → still blocked
  BEGIN PERFORM admin_delete_account(v_super, v_temp, 's-admin2-live', R);
  EXCEPTION WHEN check_violation THEN v_t := v_t || 'A:' || SQLERRM; END;
  UPDATE users SET retired_at = now() - interval '49 hours' WHERE id = v_temp;
  BEGIN PERFORM admin_delete_account(v_staff, v_temp, 's-admin2-live', R);
  EXCEPTION WHEN insufficient_privilege THEN v_t := v_t || ' B:42501'; END;
  BEGIN PERFORM admin_delete_account(v_super, v_temp, 'wrong', R);
  EXCEPTION WHEN check_violation THEN v_t := v_t || ' C:' || SQLERRM; END;
  PERFORM admin_delete_account(v_super, v_temp, 'S-ADMIN2-LIVE', R);
  SELECT count(*) INTO v_n FROM audit_logs WHERE entity_id = v_temp AND action = 'account_delete' AND created_at = now();
  v_ok := NOT EXISTS (SELECT 1 FROM users WHERE id = v_temp)
      AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_temp) AND v_n = 1;
  v_res := v_res || jsonb_build_object('18_delete_flow',
    CASE WHEN v_ok AND v_t = 'A:delete_blocked: delete_window_open B:42501 C:confirm_mismatch'
         THEN 'ok' ELSE 'FAIL ' || v_ok || ' [' || v_t || '] audit=' || v_n END);

  -- 19. An audit actor can never be deleted.
  v_ok := 'audit_actor' = ANY (account_delete_blockers(v_super));
  v_res := v_res || jsonb_build_object('19_audit_actor_blocked', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 20. Search: audited when non-empty; LIKE wildcards are literal.
  v_j := admin_search_accounts(v_super, 'test2@', 'all', 10, 0);
  SELECT count(*) INTO v_n FROM audit_logs WHERE action = 'user_search' AND admin_id = v_super AND created_at = now();
  v_ok := (v_j->>'total')::int = 1 AND v_j->'accounts'->0->>'staff_role' = 'admin' AND v_n = 1;
  v_j := admin_search_accounts(v_super, '%', 'all', 10, 0);
  v_ok := v_ok AND (v_j->>'total')::int = 0;
  v_j := admin_search_accounts(v_super, '', 'staff', 10, 0);
  v_ok := v_ok AND (v_j->>'total')::int = 2;
  SELECT count(*) INTO v_n FROM audit_logs WHERE action = 'user_search' AND admin_id = v_super AND created_at = now();
  v_ok := v_ok AND v_n = 2;  -- the empty search was not logged
  v_res := v_res || jsonb_build_object('20_search', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || v_j::text || ' audit=' || v_n END);

  -- 21. Account detail: delete block only for manage_admins; no Stripe/Yoti ids.
  v_j := admin_get_account(v_staff, v_user);
  v_ok := v_j->'delete' = 'null'::jsonb AND NOT v_j ? 'stripe_connect_account_id' AND NOT v_j ? 'yoti_session_id'
      AND v_j->>'status' = 'active';
  v_j := admin_get_account(v_super, v_user);
  v_ok := v_ok AND jsonb_typeof(v_j->'delete'->'blockers') = 'array';
  v_res := v_res || jsonb_build_object('21_account_detail', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || v_j::text END);

  -- 22. Token holdings: manage_nfc only, audited first.
  v_j := admin_get_account_tokens(v_staff, v_user);
  SELECT count(*) INTO v_n FROM audit_logs WHERE entity_id = v_user AND action = 'user_tokens_view' AND created_at = now();
  v_ok := jsonb_array_length(v_j->'tokens') >= 1 AND v_n = 1;
  PERFORM admin_set_account_role(v_super, v_staff, 'support', R);
  v_state := 'none';
  BEGIN PERFORM admin_get_account_tokens(v_staff, v_user);
  EXCEPTION WHEN insufficient_privilege THEN v_state := '42501'; END;
  v_res := v_res || jsonb_build_object('22_token_view', CASE WHEN v_ok AND v_state = '42501' THEN 'ok' ELSE 'FAIL ' || v_state || ' audit=' || v_n END);

  -- 23. Payments + pricing by permission: support may Re-apply only.
  v_state := '';
  BEGIN PERFORM payment_admin_actor_email(v_staff, false); v_state := 'reapply';
  EXCEPTION WHEN insufficient_privilege THEN v_state := 'no-reapply'; END;
  BEGIN PERFORM payment_admin_actor_email(v_staff, true); v_state := v_state || '+refund';
  EXCEPTION WHEN insufficient_privilege THEN v_state := v_state || '+no-refund'; END;
  BEGIN PERFORM admin_set_token_price(v_staff, 'transfer', 500, NULL, R); v_state := v_state || '+price';
  EXCEPTION WHEN insufficient_privilege THEN v_state := v_state || '+no-price'; END;
  BEGIN PERFORM admin_suspend_account(v_staff, v_user, 1, R); v_state := v_state || '+suspend';
  EXCEPTION WHEN insufficient_privilege THEN v_state := v_state || '+no-suspend'; END;
  v_res := v_res || jsonb_build_object('23_support_permissions', CASE WHEN v_state = 'reapply+no-refund+no-price+no-suspend' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 24. Revoke: admin access ends, users.role back to 'user', audited.
  PERFORM admin_set_account_role(v_super, v_staff, NULL, R);
  SELECT count(*) INTO v_n FROM audit_logs WHERE entity_id = v_staff AND action = 'role_revoke' AND created_at = now();
  v_ok := NOT EXISTS (SELECT 1 FROM admin_users WHERE admin_id = v_staff AND is_active)
      AND (SELECT role::text FROM users WHERE id = v_staff) = 'user' AND v_n = 1;
  v_res := v_res || jsonb_build_object('24_role_revoke', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL audit=' || v_n END);

  -- 25. Facets list known actions.
  v_j := admin_audit_log_facets();
  v_ok := v_j->'actions' ? 'account_suspend' AND v_j->'entity_types' ? 'user' AND jsonb_array_length(v_j->'actors') >= 1;
  v_res := v_res || jsonb_build_object('25_facets', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 26. Clients still cannot write retired_* on their own row.
  v_ok := NOT has_column_privilege('authenticated', 'public.users', 'retired_at', 'UPDATE')
      AND NOT has_column_privilege('authenticated', 'public.users', 'is_suspended', 'UPDATE');
  v_res := v_res || jsonb_build_object('26_status_columns_not_client_writable', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 27. Accounts banned by hand before S-ADMIN2 read as retired (9b9e).
  v_ok := NOT EXISTS (SELECT 1 FROM auth.users a JOIN users u ON u.id = a.id
                       WHERE a.banned_until > now() + interval '50 years' AND u.retired_at IS NULL)
      AND (SELECT count(*) FROM auth.users WHERE banned_until > now() + interval '50 years') >= 1;
  v_res := v_res || jsonb_build_object('27_hand_retired_backfilled', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 28. Delete refuses an account other records point at (test@ has transfers).
  v_ok := 'account_has_history' = ANY (account_delete_blockers(v_user));
  v_res := v_res || jsonb_build_object('28_linked_records_block_delete', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || array_to_string(account_delete_blockers(v_user), ',') END);

  -- 29. A plain admin cannot reactivate an ex-staff account a super_admin retired.
  PERFORM admin_set_account_role(v_super, v_staff, 'support', R);
  PERFORM admin_retire_account(v_super, v_staff, R);
  INSERT INTO auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at)
  VALUES (v_temp, v_temp_email, 'authenticated', 'authenticated', now(), now(), now());
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_temp) THEN
    INSERT INTO users (id, email) VALUES (v_temp, v_temp_email);
  END IF;
  PERFORM admin_set_account_role(v_super, v_temp, 'admin', R);
  v_state := 'none';
  BEGIN PERFORM admin_reactivate_account(v_temp, v_staff, R);
  EXCEPTION WHEN insufficient_privilege THEN v_state := '42501'; END;
  PERFORM admin_reactivate_account(v_super, v_staff, R);
  v_res := v_res || jsonb_build_object('29_reactivate_ex_staff_needs_super', CASE WHEN v_state = '42501' AND account_status_of(v_staff) = 'active' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 30. Accounts retired by hand before S-ADMIN2 keep their staff history:
  --     the backfill recorded the role, so a plain admin cannot reactivate them.
  SELECT id INTO v_fn FROM users WHERE retire_reason LIKE '%before S-ADMIN2%' AND retired_role IS NOT NULL LIMIT 1;
  v_state := 'none';
  IF v_fn IS NOT NULL THEN
    BEGIN PERFORM admin_reactivate_account(v_temp, v_fn::uuid, R);
    EXCEPTION WHEN insufficient_privilege THEN v_state := '42501'; END;
    v_ok := v_state = '42501'
        AND admin_get_account(v_super, v_fn::uuid)->>'retired_staff_role' IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM admin_users x JOIN users u ON u.id = x.admin_id
                         WHERE u.retired_at IS NOT NULL AND x.is_active);
  ELSE
    v_ok := false; v_state := 'no hand-retired ex-staff account found';
  END IF;
  v_res := v_res || jsonb_build_object('30_hand_retired_staff_needs_super', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 31. An expired suspension can still be lifted, which clears its leftovers.
  PERFORM admin_suspend_account(v_super, v_user, 1, R);
  UPDATE users SET suspended_until = now() - interval '1 minute' WHERE id = v_user;
  v_ok := account_status_of(v_user) = 'active';
  PERFORM admin_unsuspend_account(v_super, v_user, R);
  v_ok := v_ok AND NOT (SELECT coalesce(is_suspended, false) FROM users WHERE id = v_user)
      AND (SELECT suspended_until FROM users WHERE id = v_user) IS NULL;
  v_res := v_res || jsonb_build_object('31_unsuspend_expired_clears', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 32. Reactivating an account whose suspension is still running leaves it
  --     suspended, with the sign-in ban ending when the suspension does.
  PERFORM admin_suspend_account(v_super, v_staff, 24, R);
  PERFORM admin_retire_account(v_super, v_staff, R);
  v_j := admin_reactivate_account(v_temp, v_staff, R);
  v_ok := v_j->>'status' = 'suspended' AND account_status_of(v_staff) = 'suspended'
      AND (SELECT a.banned_until = u.suspended_until FROM auth.users a JOIN users u ON u.id = a.id WHERE a.id = v_staff);
  v_res := v_res || jsonb_build_object('32_reactivate_keeps_running_suspension', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || v_j::text END);

  -- 33. Records pointing at the account's staff row also block Delete
  --     (the preview and the delete agree).
  v_ok := NOT ('account_has_history' = ANY (account_delete_blockers(v_temp)));
  UPDATE users SET banned_by = v_temp WHERE id = v_user;
  v_ok := v_ok AND 'account_has_history' = ANY (account_delete_blockers(v_temp));
  v_res := v_res || jsonb_build_object('33_staff_row_references_block_delete', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || array_to_string(account_delete_blockers(v_temp), ',') END);

  -- 34. Changing or revoking a staff role signs the account out everywhere; a
  --     grant does not (20261026000001). v_temp is an admin since check 29.
  INSERT INTO auth.sessions (id, user_id, created_at, updated_at)
  VALUES ('a2a2a2a2-0000-4000-8000-0000000000e1'::uuid, v_temp, now(), now());
  PERFORM admin_set_account_role(v_super, v_temp, 'support', R);
  v_ok := NOT EXISTS (SELECT 1 FROM auth.sessions WHERE user_id = v_temp);
  INSERT INTO auth.sessions (id, user_id, created_at, updated_at)
  VALUES ('a2a2a2a2-0000-4000-8000-0000000000e2'::uuid, v_temp, now(), now());
  PERFORM admin_set_account_role(v_super, v_temp, NULL, R);
  v_ok := v_ok AND NOT EXISTS (SELECT 1 FROM auth.sessions WHERE user_id = v_temp);
  INSERT INTO auth.sessions (id, user_id, created_at, updated_at)
  VALUES ('a2a2a2a2-0000-4000-8000-0000000000e3'::uuid, v_temp, now(), now());
  PERFORM admin_set_account_role(v_super, v_temp, 'support', R);
  v_ok := v_ok AND EXISTS (SELECT 1 FROM auth.sessions WHERE user_id = v_temp)
      AND (SELECT (changes->>'sessions_ended')::int FROM audit_logs
            WHERE entity_id = v_temp AND action = 'role_revoke' AND created_at = now() LIMIT 1) = 1;
  v_res := v_res || jsonb_build_object('34_role_change_ends_sessions', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- Compact summary: the error text is length-limited, so print totals plus
  -- every failing check in full (jsonb orders keys by length, long ones last).
  RAISE EXCEPTION 'RESULTS %', (
    SELECT jsonb_build_object(
             'total', count(*),
             'ok', count(*) FILTER (WHERE value = '"ok"'::jsonb),
             'failures', coalesce(jsonb_object_agg(key, value) FILTER (WHERE value <> '"ok"'::jsonb), '{}'::jsonb))
      FROM jsonb_each(v_res));
END;
$$;
