-- S-SEC hotfix — live checks for 20261025000001_s_sec_hotfix_lockdown.sql.
--
-- Leaves NOTHING behind: one DO block that ends by raising an exception with
-- the results, so the test UPDATEs roll back. Switches into the anon /
-- authenticated roles with a fake JWT claim to exercise RLS as a real caller.
--
-- Run: supabase db query --linked -f supabase/tests/s_sec_hotfix_lockdown_live.sql
-- Expect: ERROR  P0001: RESULTS {...} with every check "ok".

DO $$
DECLARE
  v_user   CONSTANT UUID := '0b211aed-3cf9-4729-818d-f0ed88dd68b8';  -- test@ (plain user)
  v_admin  CONSTANT UUID := '2b3f1532-9345-4720-8fac-55d07517c78b';  -- super_admin (view_users)
  v_fns    CONSTANT TEXT[] := ARRAY[
    'public.suspend_user(uuid, integer, text, uuid)',
    'public.unsuspend_user(uuid, uuid)',
    'public.ban_user(uuid, text, uuid)',
    'public.unban_user(uuid, uuid)',
    'public.deactivate_admin(uuid, text)',
    'public.reactivate_admin(uuid)',
    'public.revoke_admin_session(uuid)',
    'public.apply_payment_penalty(uuid, uuid, uuid)',
    'public.get_next_eligible_bidder(uuid, uuid[])',
    'public.calculate_processor_success_rate(payment_processor, integer)',
    'public.generate_token_name(uuid)'];
  v_fn     TEXT;
  v_total  BIGINT;
  v_n      BIGINT;
  v_ok     BOOLEAN;
  v_res    JSONB := '{}'::jsonb;
  v_state  TEXT;
BEGIN
  SELECT count(*) INTO v_total FROM public.users;

  -- 01. No client role can execute the locked functions; service_role can.
  v_ok := true;
  FOREACH v_fn IN ARRAY v_fns LOOP
    v_ok := v_ok
      AND NOT has_function_privilege('anon', v_fn, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
      AND has_function_privilege('service_role', v_fn, 'EXECUTE');
  END LOOP;
  v_res := v_res || jsonb_build_object('01_functions_service_only', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 02. RLS helper functions are still callable by signed-in users.
  v_ok := has_function_privilege('authenticated', 'public.is_admin_with_permission(uuid, text)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.is_active_admin(uuid)', 'EXECUTE');
  v_res := v_res || jsonb_build_object('02_rls_helpers_callable', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 03. anon sees no users.
  EXECUTE 'SET LOCAL ROLE anon';
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SELECT count(*) INTO v_n FROM public.users;
  EXECUTE 'RESET ROLE';
  v_res := v_res || jsonb_build_object('03_anon_sees_none', CASE WHEN v_n = 0 THEN 'ok' ELSE 'FAIL ' || v_n END);

  -- 04. anon calling a locked function is refused (42501).
  v_state := 'none';
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM public.deactivate_admin(v_admin, 'live check');
  EXCEPTION WHEN insufficient_privilege THEN v_state := '42501';
  END;
  EXECUTE 'RESET ROLE';
  v_res := v_res || jsonb_build_object('04_anon_rpc_refused', CASE WHEN v_state = '42501' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 05. anon queries on tables whose policies subquery users still run (no error).
  v_state := 'ran';
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM count(*) FROM public.listings;
    PERFORM count(*) FROM public.listing_media;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE || ' ' || SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  v_res := v_res || jsonb_build_object('05_anon_policy_subqueries_run', CASE WHEN v_state = 'ran' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 06. A plain user sees exactly their own row, including their email.
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.users;
  SELECT count(*) INTO v_total FROM public.users WHERE id = v_user AND email IS NOT NULL;
  EXECUTE 'RESET ROLE';
  v_res := v_res || jsonb_build_object('06_user_sees_own_row_only', CASE WHEN v_n = 1 AND v_total = 1 THEN 'ok' ELSE 'FAIL ' || v_n END);
  SELECT count(*) INTO v_total FROM public.users;

  -- 07. A plain user can still edit the profile fields the app writes.
  v_state := 'ran';
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    UPDATE public.users SET display_name = display_name, phone_number = phone_number, photo_url = photo_url,
      preferred_brand = preferred_brand, updated_at = now() WHERE id = v_user;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE || ' ' || SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  v_res := v_res || jsonb_build_object('07_user_edits_profile', CASE WHEN v_state = 'ran' AND v_n = 1 THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 08. ...but not email, suspension, ban, age or seller verification, country.
  v_ok := true;
  FOREACH v_fn IN ARRAY ARRAY[
    'email = ''attacker@example.com''',
    'is_suspended = false',
    'is_banned = false',
    'age_verified = true',
    'seller_verification_status = ''APPROVED''',
    'billing_country = ''CA''',
    'role = ''super_admin'''] LOOP
    v_state := 'allowed';
    BEGIN
      EXECUTE 'SET LOCAL ROLE authenticated';
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
      EXECUTE format('UPDATE public.users SET %s WHERE id = %L', v_fn, v_user);
    EXCEPTION WHEN insufficient_privilege THEN v_state := '42501';
    END;
    EXECUTE 'RESET ROLE';
    IF v_state <> '42501' THEN
      v_ok := false;
      v_res := v_res || jsonb_build_object('08_detail_' || split_part(v_fn, ' ', 1), 'FAIL ' || v_state);
    END IF;
  END LOOP;
  v_res := v_res || jsonb_build_object('08_user_cannot_edit_protected', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 09. Staff with view_users sees every row.
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.users;
  EXECUTE 'RESET ROLE';
  v_res := v_res || jsonb_build_object('09_staff_sees_all', CASE WHEN v_n = v_total THEN 'ok' ELSE 'FAIL ' || v_n || '/' || v_total END);

  -- 10. Signed-in queries on tables whose policies subquery users still run.
  v_state := 'ran';
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    PERFORM count(*) FROM public.listings;
    PERFORM count(*) FROM public.payments;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE || ' ' || SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  v_res := v_res || jsonb_build_object('10_user_policy_subqueries_run', CASE WHEN v_state = 'ran' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 11. The old open policy is gone.
  v_ok := NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users'
                      AND policyname = 'Anyone can view users');
  v_res := v_res || jsonb_build_object('11_open_policy_dropped', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  RAISE EXCEPTION 'RESULTS %', v_res;
END $$;
