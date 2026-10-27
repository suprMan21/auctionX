-- S-2FA Ph2b — live checks for 20261027000010 (password / email change lock).
--
-- Leaves NOTHING behind: one DO block that ends by raising an exception with
-- the results, so every change (throwaway accounts, passkey, permits, the
-- auth.users writes) rolls back.
--
-- What this proves that the backend tests cannot: the trigger on auth.users
-- really refuses a password change or an email-change request without a
-- permit, spends exactly one permit of the right kind, respects expiry, leaves
-- routine GoTrue writes and accounts without a second factor alone, and the
-- permit table and guard function are closed to anon / authenticated.
--
-- Run: supabase db query --linked -f supabase/tests/s_2fa_account_change_live.sql
-- Expect: ERROR  P0001: RESULTS {"ok": 15, "total": 15, "failures": {}}

DO $$
DECLARE
  v_a     CONSTANT UUID := 'a2fa2fa2-0000-4000-8000-00000000c401';  -- has a passkey
  v_b     CONSTANT UUID := 'a2fa2fa2-0000-4000-8000-00000000c402';  -- no second factor
  v_ok    BOOLEAN;
  v_state TEXT;
  v_res   JSONB := '{}'::jsonb;
  v_fail  JSONB;
BEGIN
  -- 01. The trigger exists on auth.users, BEFORE UPDATE, and is enabled.
  SELECT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgname = 'guard_auth_change' AND t.tgrelid = 'auth.users'::regclass
                    AND NOT t.tgisinternal AND t.tgenabled <> 'D'
                    AND t.tgfoid = 'public.guard_auth_change()'::regprocedure)
    INTO v_ok;
  v_res := v_res || jsonb_build_object('01_trigger_exists', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 02. The guard function is not callable by anon / authenticated, and is SECURITY DEFINER.
  SELECT NOT has_function_privilege('anon', 'public.guard_auth_change()', 'EXECUTE')
     AND NOT has_function_privilege('authenticated', 'public.guard_auth_change()', 'EXECUTE')
     AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.guard_auth_change()'::regprocedure)
    INTO v_ok;
  v_res := v_res || jsonb_build_object('02_function_closed', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 03. anon / authenticated cannot read or write permits; service_role can.
  SELECT NOT has_table_privilege('anon', 'public.auth_change_permits', 'SELECT')
     AND NOT has_table_privilege('anon', 'public.auth_change_permits', 'INSERT')
     AND NOT has_table_privilege('authenticated', 'public.auth_change_permits', 'SELECT')
     AND NOT has_table_privilege('authenticated', 'public.auth_change_permits', 'INSERT')
     AND NOT has_table_privilege('authenticated', 'public.auth_change_permits', 'UPDATE')
     AND has_table_privilege('service_role', 'public.auth_change_permits', 'INSERT')
     AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.auth_change_permits'::regclass)
    INTO v_ok;
  v_res := v_res || jsonb_build_object('03_permits_closed', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 04. step_up_grants accepts 'account_change' and still refuses junk.
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (v_a, 's2fa-lock-a@example.invalid', 'authenticated', 'authenticated'),
    (v_b, 's2fa-lock-b@example.invalid', 'authenticated', 'authenticated');
  INSERT INTO users (id, email) VALUES
    (v_a, 's2fa-lock-a@example.invalid'), (v_b, 's2fa-lock-b@example.invalid')
  ON CONFLICT (id) DO NOTHING;
  v_state := 'ok';
  BEGIN
    INSERT INTO step_up_grants (token_hash, user_id, session_id, action, target_id, expires_at, method)
    VALUES (repeat('d1', 32), v_a, gen_random_uuid(), 'account_change', 'password', now() + interval '2 minutes', 'passkey');
  EXCEPTION WHEN OTHERS THEN v_state := 'FAIL ' || SQLERRM; END;
  IF v_state = 'ok' THEN
    BEGIN
      INSERT INTO step_up_grants (token_hash, user_id, session_id, action, target_id, expires_at)
      VALUES (repeat('d2', 32), v_a, gen_random_uuid(), 'reset_password', 'x', now() + interval '2 minutes');
      v_state := 'FAIL junk action accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;
  END IF;
  v_res := v_res || jsonb_build_object('04_account_change_action_allowed', v_state);

  INSERT INTO user_passkeys (user_id, credential_id, public_key, nickname)
  VALUES (v_a, 's2fa-lock-cred-000001', 'pk', 'Key');

  -- 05. Password change refused without a permit.
  v_state := 'FAIL allowed';
  BEGIN UPDATE auth.users SET encrypted_password = 'p1' WHERE id = v_a;
  EXCEPTION WHEN insufficient_privilege THEN v_state := CASE WHEN SQLERRM = 'second_factor_required' THEN 'ok' ELSE 'FAIL ' || SQLERRM END; END;
  v_res := v_res || jsonb_build_object('05_password_refused_without_permit', v_state);

  -- 06. Allowed with a permit, and the permit is marked used.
  INSERT INTO auth_change_permits (user_id, kind, expires_at) VALUES (v_a, 'password', now() + interval '2 minutes');
  v_state := 'ok';
  BEGIN UPDATE auth.users SET encrypted_password = 'p2' WHERE id = v_a;
  EXCEPTION WHEN OTHERS THEN v_state := 'FAIL ' || SQLERRM; END;
  SELECT v_state = 'ok'
     AND (SELECT count(*) FROM auth_change_permits WHERE user_id = v_a AND kind = 'password' AND used_at IS NOT NULL) = 1
     AND (SELECT encrypted_password FROM auth.users WHERE id = v_a) = 'p2'
    INTO v_ok;
  v_res := v_res || jsonb_build_object('06_password_allowed_with_permit', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 07. A permit is single use.
  v_state := 'FAIL allowed';
  BEGIN UPDATE auth.users SET encrypted_password = 'p3' WHERE id = v_a;
  EXCEPTION WHEN insufficient_privilege THEN v_state := 'ok'; END;
  v_res := v_res || jsonb_build_object('07_permit_single_use', v_state);

  -- 08. Two live permits: one change spends exactly one.
  INSERT INTO auth_change_permits (user_id, kind, expires_at) VALUES
    (v_a, 'password', now() + interval '2 minutes'), (v_a, 'password', now() + interval '2 minutes');
  UPDATE auth.users SET encrypted_password = 'p4' WHERE id = v_a;
  SELECT (SELECT count(*) FROM auth_change_permits WHERE user_id = v_a AND kind = 'password' AND used_at IS NULL) = 1
    INTO v_ok;
  v_res := v_res || jsonb_build_object('08_one_change_spends_one_permit', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);
  UPDATE auth_change_permits SET used_at = now() WHERE user_id = v_a AND used_at IS NULL;

  -- 09. An expired permit does not count (and is not spent).
  INSERT INTO auth_change_permits (user_id, kind, expires_at) VALUES (v_a, 'password', now() - interval '1 second');
  v_state := 'FAIL allowed';
  BEGIN UPDATE auth.users SET encrypted_password = 'p5' WHERE id = v_a;
  EXCEPTION WHEN insufficient_privilege THEN v_state := 'ok'; END;
  SELECT v_state = 'ok'
     AND (SELECT count(*) FROM auth_change_permits WHERE user_id = v_a AND expires_at < now() AND used_at IS NULL) = 1
    INTO v_ok;
  v_res := v_res || jsonb_build_object('09_expired_permit_refused', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 10. Kind mismatch: an email permit cannot change the password (and is not spent).
  INSERT INTO auth_change_permits (user_id, kind, expires_at) VALUES (v_a, 'email', now() + interval '2 minutes');
  v_state := 'FAIL allowed';
  BEGIN UPDATE auth.users SET encrypted_password = 'p6' WHERE id = v_a;
  EXCEPTION WHEN insufficient_privilege THEN v_state := 'ok'; END;
  SELECT v_state = 'ok'
     AND (SELECT count(*) FROM auth_change_permits WHERE user_id = v_a AND kind = 'email' AND used_at IS NULL) = 1
    INTO v_ok;
  v_res := v_res || jsonb_build_object('10_email_permit_cannot_change_password', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || v_state END);
  UPDATE auth_change_permits SET used_at = now() WHERE user_id = v_a AND used_at IS NULL;

  -- 11. Email change request refused without a permit.
  v_state := 'FAIL allowed';
  BEGIN UPDATE auth.users SET email_change = 'new@example.invalid' WHERE id = v_a;
  EXCEPTION WHEN insufficient_privilege THEN v_state := 'ok'; END;
  v_res := v_res || jsonb_build_object('11_email_change_refused_without_permit', v_state);

  -- 12. Email change request allowed with an email permit; the /verify swap
  --     (email set, email_change cleared) needs no second permit.
  INSERT INTO auth_change_permits (user_id, kind, expires_at) VALUES (v_a, 'email', now() + interval '2 minutes');
  v_state := 'ok';
  BEGIN
    UPDATE auth.users SET email_change = 'new@example.invalid' WHERE id = v_a;
    UPDATE auth.users SET email = 'new@example.invalid', email_change = '' WHERE id = v_a;
  EXCEPTION WHEN OTHERS THEN v_state := 'FAIL ' || SQLERRM; END;
  v_res := v_res || jsonb_build_object('12_email_change_with_permit_then_verify', v_state);

  -- 13. Routine GoTrue writes are untouched, including a full-row update that
  --     names the guarded columns without changing them.
  v_state := 'ok';
  BEGIN
    UPDATE auth.users SET last_sign_in_at = now(), raw_user_meta_data = '{"x":1}' WHERE id = v_a;
    UPDATE auth.users SET encrypted_password = encrypted_password, email_change = email_change, updated_at = now() WHERE id = v_a;
  EXCEPTION WHEN OTHERS THEN v_state := 'FAIL ' || SQLERRM; END;
  v_res := v_res || jsonb_build_object('13_routine_writes_untouched', v_state);

  -- 14. An account with no second factor is unaffected.
  v_state := 'ok';
  BEGIN
    UPDATE auth.users SET encrypted_password = 'b1' WHERE id = v_b;
    UPDATE auth.users SET email_change = 'b-new@example.invalid' WHERE id = v_b;
  EXCEPTION WHEN OTHERS THEN v_state := 'FAIL ' || SQLERRM; END;
  v_res := v_res || jsonb_build_object('14_no_factor_account_unaffected', v_state);

  -- 15. An unconfirmed authenticator setup is not a second factor; a confirmed one is.
  INSERT INTO user_totp_factors (user_id, secret_enc) VALUES (v_b, 'v1.iv.tag.ct');
  v_state := 'ok';
  BEGIN UPDATE auth.users SET encrypted_password = 'b2' WHERE id = v_b;
  EXCEPTION WHEN OTHERS THEN v_state := 'FAIL unconfirmed app blocked: ' || SQLERRM; END;
  IF v_state = 'ok' THEN
    UPDATE user_totp_factors SET verified_at = now() WHERE user_id = v_b;
    v_state := 'FAIL confirmed app not guarded';
    BEGIN UPDATE auth.users SET encrypted_password = 'b3' WHERE id = v_b;
    EXCEPTION WHEN insufficient_privilege THEN v_state := 'ok'; END;
  END IF;
  v_res := v_res || jsonb_build_object('15_confirmed_authenticator_app_guarded', v_state);

  SELECT jsonb_object_agg(k, v) INTO v_fail FROM jsonb_each_text(v_res) AS e(k, v) WHERE v <> 'ok';
  RAISE EXCEPTION 'RESULTS %', jsonb_build_object(
    'ok', (SELECT count(*) FROM jsonb_each_text(v_res) e(k, v) WHERE v = 'ok'),
    'total', (SELECT count(*) FROM jsonb_each_text(v_res)),
    'failures', coalesce(v_fail, '{}'::jsonb));
END $$;
