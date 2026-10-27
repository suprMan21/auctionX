-- S-2FA Ph1 — live checks for 20261027000006 (second factors, marker, step-up).
--
-- Leaves NOTHING behind: one DO block that ends by raising an exception with
-- the results, so every change (throwaway accounts and their rows) rolls back.
--
-- What this proves that the backend tests cannot: grants and RLS on the real
-- tables, the CHECK constraints (including the NULL cases), the atomic
-- functions, the "use once" conditional updates, cascade on account delete,
-- and that second-factor rows do not block an account delete.
-- Concurrency: each "use once" is a single-row UPDATE ... WHERE used_at IS NULL;
-- Postgres row locking makes a second concurrent UPDATE re-check that predicate
-- after the first commits, so it matches nothing. Shown here sequentially.
--
-- Run: supabase db query --linked -f supabase/tests/s_2fa_live.sql
-- Expect: ERROR  P0001: RESULTS {"ok": 16, "total": 16, "failures": {}}

DO $$
DECLARE
  v_a     CONSTANT UUID := 'a2fa2fa2-0000-4000-8000-00000000a201';  -- throwaway accounts
  v_b     CONSTANT UUID := 'a2fa2fa2-0000-4000-8000-00000000a202';
  v_s     CONSTANT UUID := 'a2fa2fa2-0000-4000-8000-0000000005e1';  -- a session id
  H       CONSTANT TEXT := repeat('ab', 32);                          -- a valid-looking hash
  v_tables CONSTANT TEXT[] := ARRAY['user_passkeys', 'user_totp_factors', 'user_recovery_codes',
                                    'mfa_challenges', 'mfa_sessions', 'step_up_grants', 'user_mfa_state'];
  v_t     TEXT;
  v_ok    BOOLEAN;
  v_state TEXT;
  v_n     INTEGER;
  v_id    UUID;
  v_lock  TIMESTAMPTZ;
  v_arr   TEXT[];
  v_res   JSONB := '{}'::jsonb;
  v_fail  JSONB;
BEGIN
  INSERT INTO users (id, email) VALUES (v_a, 's2fa-a@example.invalid'), (v_b, 's2fa-b@example.invalid');

  -- 01. All seven tables exist with RLS on and no policies.
  v_ok := true;
  FOREACH v_t IN ARRAY v_tables LOOP
    v_ok := v_ok
      AND coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || v_t)), false)
      AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = v_t);
  END LOOP;
  v_res := v_res || jsonb_build_object('01_rls_on_no_policies', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 02. anon and authenticated have no privilege on any of them; service_role has all four.
  v_ok := true;
  FOREACH v_t IN ARRAY v_tables LOOP
    v_ok := v_ok
      AND NOT has_table_privilege('anon', 'public.' || v_t, 'SELECT, INSERT, UPDATE, DELETE')
      AND NOT has_table_privilege('authenticated', 'public.' || v_t, 'SELECT, INSERT, UPDATE, DELETE')
      AND has_table_privilege('service_role', 'public.' || v_t, 'SELECT')
      AND has_table_privilege('service_role', 'public.' || v_t, 'INSERT')
      AND has_table_privilege('service_role', 'public.' || v_t, 'UPDATE')
      AND has_table_privilege('service_role', 'public.' || v_t, 'DELETE');
  END LOOP;
  v_res := v_res || jsonb_build_object('02_no_client_grants', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 03. The functions are service_role only.
  v_ok := true;
  FOREACH v_t IN ARRAY ARRAY['public.replace_recovery_codes(uuid, text[])', 'public.record_mfa_failure(uuid)',
                             'public.account_delete_blockers(uuid)'] LOOP
    v_ok := v_ok AND to_regprocedure(v_t) IS NOT NULL
      AND NOT has_function_privilege('anon', v_t, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', v_t, 'EXECUTE')
      AND has_function_privilege('service_role', v_t, 'EXECUTE');
  END LOOP;
  v_res := v_res || jsonb_build_object('03_functions_service_only', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 04. replace_recovery_codes needs exactly 10 (9 and NULL refused).
  v_state := '';
  BEGIN PERFORM replace_recovery_codes(v_a, ARRAY(SELECT md5(i::text) || md5(i::text) FROM generate_series(1, 9) i));
  EXCEPTION WHEN check_violation THEN v_state := 'r9'; END;
  BEGIN PERFORM replace_recovery_codes(v_a, NULL);
  EXCEPTION WHEN check_violation THEN v_state := v_state || '+rnull'; END;
  v_res := v_res || jsonb_build_object('04_codes_need_ten', CASE WHEN v_state = 'r9+rnull' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 05. A new set replaces the old one completely.
  PERFORM replace_recovery_codes(v_a, ARRAY(SELECT md5('old' || i) || md5('old' || i) FROM generate_series(1, 10) i));
  UPDATE user_recovery_codes SET used_at = now() WHERE user_id = v_a AND code_hash = md5('old1') || md5('old1');
  PERFORM replace_recovery_codes(v_a, ARRAY(SELECT md5('new' || i) || md5('new' || i) FROM generate_series(1, 10) i));
  SELECT count(*) INTO v_n FROM user_recovery_codes WHERE user_id = v_a AND used_at IS NULL AND code_hash LIKE md5('new1') || '%' ;
  v_ok := v_n = 1
      AND (SELECT count(*) FROM user_recovery_codes WHERE user_id = v_a) = 10
      AND NOT EXISTS (SELECT 1 FROM user_recovery_codes WHERE user_id = v_a AND code_hash = md5('old2') || md5('old2'));
  v_res := v_res || jsonb_build_object('05_new_set_replaces_old', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 06. A code is spent once: the second conditional update matches nothing.
  UPDATE user_recovery_codes SET used_at = now()
   WHERE user_id = v_a AND code_hash = md5('new2') || md5('new2') AND used_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_state := v_n::text;
  UPDATE user_recovery_codes SET used_at = now()
   WHERE user_id = v_a AND code_hash = md5('new2') || md5('new2') AND used_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_state := v_state || '/' || v_n::text;
  v_res := v_res || jsonb_build_object('06_code_used_once', CASE WHEN v_state = '1/0' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 07. Lockout: 4 wrong → no lock, 5th → 15-minute lock, an expired lock starts a fresh count.
  FOR i IN 1..4 LOOP v_lock := record_mfa_failure(v_a); END LOOP;
  v_state := CASE WHEN v_lock IS NULL THEN 'free4' ELSE 'locked4' END;
  v_lock := record_mfa_failure(v_a);
  v_state := v_state || CASE WHEN v_lock BETWEEN now() + interval '14 minutes' AND now() + interval '16 minutes' THEN '+locked5' ELSE '+bad5' END;
  UPDATE user_mfa_state SET locked_until = now() - interval '1 second' WHERE user_id = v_a;
  v_lock := record_mfa_failure(v_a);
  v_state := v_state || CASE WHEN v_lock IS NULL AND (SELECT failed_attempts FROM user_mfa_state WHERE user_id = v_a) = 1
                             THEN '+reset' ELSE '+noreset' END;
  v_res := v_res || jsonb_build_object('07_lockout', CASE WHEN v_state = 'free4+locked5+reset' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 08. CHECKs refuse NULL and bad values (a CHECK on NULL passes unless coalesced).
  v_state := '';
  BEGIN INSERT INTO mfa_challenges (user_id, session_id, purpose, challenge, expires_at) VALUES (v_a, v_s, NULL, 'c', now());
  EXCEPTION WHEN check_violation OR not_null_violation THEN v_state := v_state || 'p'; END;
  BEGIN INSERT INTO mfa_challenges (user_id, session_id, purpose, challenge, expires_at) VALUES (v_a, v_s, 'step_up', 'c', now());
  EXCEPTION WHEN check_violation THEN v_state := v_state || 's'; END;
  BEGIN INSERT INTO mfa_challenges (user_id, session_id, purpose, challenge, action, target_id, expires_at)
        VALUES (v_a, v_s, 'sign_in', 'c', 'release', 't', now());
  EXCEPTION WHEN check_violation THEN v_state := v_state || 'n'; END;
  BEGIN INSERT INTO mfa_sessions (session_id, user_id, method, expires_at) VALUES (gen_random_uuid(), v_a, 'sms', now());
  EXCEPTION WHEN check_violation THEN v_state := v_state || 'm'; END;
  BEGIN INSERT INTO step_up_grants (token_hash, user_id, session_id, action, target_id, expires_at)
        VALUES (H, v_a, v_s, 'anything', 't', now());
  EXCEPTION WHEN check_violation THEN v_state := v_state || 'g'; END;
  BEGIN INSERT INTO step_up_grants (token_hash, user_id, session_id, action, target_id, expires_at)
        VALUES ('nothex', v_a, v_s, 'release', 't', now());
  EXCEPTION WHEN check_violation THEN v_state := v_state || 'h'; END;
  BEGIN INSERT INTO user_passkeys (user_id, credential_id, public_key, nickname) VALUES (v_a, 'AAAAAAAAAAAAAAAAAAAA', 'k', '   ');
  EXCEPTION WHEN check_violation THEN v_state := v_state || 'k'; END;
  BEGIN INSERT INTO user_passkeys (user_id, credential_id, public_key, nickname) VALUES (v_a, 'bad id!', 'k', 'x');
  EXCEPTION WHEN check_violation THEN v_state := v_state || 'c'; END;
  BEGIN INSERT INTO user_totp_factors (user_id, secret_enc) VALUES (v_a, 'plaintext');
  EXCEPTION WHEN check_violation THEN v_state := v_state || 't'; END;
  v_res := v_res || jsonb_build_object('08_checks_refuse_bad_rows', CASE WHEN v_state = 'psnmghkct' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 09. A challenge is spent once, and never after it expires.
  INSERT INTO mfa_challenges (user_id, session_id, purpose, challenge, expires_at)
  VALUES (v_a, v_s, 'sign_in', 'c1', now() + interval '5 minutes') RETURNING id INTO v_id;
  UPDATE mfa_challenges SET used_at = now() WHERE id = v_id AND used_at IS NULL AND expires_at > now();
  GET DIAGNOSTICS v_n = ROW_COUNT; v_state := v_n::text;
  UPDATE mfa_challenges SET used_at = now() WHERE id = v_id AND used_at IS NULL AND expires_at > now();
  GET DIAGNOSTICS v_n = ROW_COUNT; v_state := v_state || '/' || v_n::text;
  INSERT INTO mfa_challenges (user_id, session_id, purpose, challenge, expires_at)
  VALUES (v_a, v_s, 'sign_in', 'c2', now() - interval '1 second') RETURNING id INTO v_id;
  UPDATE mfa_challenges SET used_at = now() WHERE id = v_id AND used_at IS NULL AND expires_at > now();
  GET DIAGNOSTICS v_n = ROW_COUNT; v_state := v_state || '/' || v_n::text;
  v_res := v_res || jsonb_build_object('09_challenge_once', CASE WHEN v_state = '1/0/0' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 10. A grant is spent once, only for its own action and target.
  INSERT INTO step_up_grants (token_hash, user_id, session_id, action, target_id, expires_at)
  VALUES (H, v_a, v_s, 'release', 'tag-1', now() + interval '2 minutes');
  UPDATE step_up_grants SET used_at = now()
   WHERE token_hash = H AND user_id = v_a AND session_id = v_s AND action = 'release' AND target_id = 'tag-2'
     AND used_at IS NULL AND expires_at > now();
  GET DIAGNOSTICS v_n = ROW_COUNT; v_state := v_n::text;
  UPDATE step_up_grants SET used_at = now()
   WHERE token_hash = H AND user_id = v_a AND session_id = v_s AND action = 'release' AND target_id = 'tag-1'
     AND used_at IS NULL AND expires_at > now();
  GET DIAGNOSTICS v_n = ROW_COUNT; v_state := v_state || '/' || v_n::text;
  UPDATE step_up_grants SET used_at = now()
   WHERE token_hash = H AND user_id = v_a AND session_id = v_s AND action = 'release' AND target_id = 'tag-1'
     AND used_at IS NULL AND expires_at > now();
  GET DIAGNOSTICS v_n = ROW_COUNT; v_state := v_state || '/' || v_n::text;
  v_res := v_res || jsonb_build_object('10_grant_once', CASE WHEN v_state = '0/1/0' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 11. One credential id belongs to one account only; one authenticator app per account.
  INSERT INTO user_passkeys (user_id, credential_id, public_key, nickname) VALUES (v_a, 'CREDCREDCREDCREDCRED', 'k', 'x');
  v_state := '';
  BEGIN INSERT INTO user_passkeys (user_id, credential_id, public_key, nickname) VALUES (v_b, 'CREDCREDCREDCREDCRED', 'k', 'x');
  EXCEPTION WHEN unique_violation THEN v_state := 'cred'; END;
  INSERT INTO user_totp_factors (user_id, secret_enc) VALUES (v_a, 'v1.a.b.c');
  BEGIN INSERT INTO user_totp_factors (user_id, secret_enc) VALUES (v_a, 'v1.d.e.f');
  EXCEPTION WHEN unique_violation THEN v_state := v_state || '+totp'; END;
  v_res := v_res || jsonb_build_object('11_unique', CASE WHEN v_state = 'cred+totp' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 12. Second-factor rows do not block deleting a retired account.
  INSERT INTO mfa_sessions (session_id, user_id, method, expires_at) VALUES (v_s, v_a, 'passkey', now() + interval '1 hour');
  INSERT INTO user_mfa_state (user_id) VALUES (v_a) ON CONFLICT DO NOTHING;
  UPDATE users SET retired_at = now() - interval '30 days' WHERE id = v_a;
  v_arr := account_delete_blockers(v_a);
  v_res := v_res || jsonb_build_object('12_mfa_rows_do_not_block_delete',
    CASE WHEN NOT ('account_has_history' = ANY(v_arr)) THEN 'ok' ELSE 'FAIL ' || array_to_string(v_arr, ',') END);

  -- 13. ...and they go with the account.
  DELETE FROM users WHERE id = v_a;
  v_ok := true;
  FOREACH v_t IN ARRAY v_tables LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE user_id = $1', v_t) INTO v_n USING v_a;
    v_ok := v_ok AND v_n = 0;
  END LOOP;
  v_res := v_res || jsonb_build_object('13_cascade_on_delete', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 14. The blocker function still blocks for real history (control for 12).
  v_arr := account_delete_blockers(v_b);
  v_res := v_res || jsonb_build_object('14_unretired_still_blocked',
    CASE WHEN 'not_retired' = ANY(v_arr) THEN 'ok' ELSE 'FAIL ' || array_to_string(v_arr, ',') END);

  -- 15. Hourly cleanup is scheduled.
  v_ok := EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mfa-cleanup' AND schedule = '23 * * * *');
  v_res := v_res || jsonb_build_object('15_cleanup_scheduled', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 16. Sweep: no SECURITY DEFINER function in public is callable by anon (Every-Session lesson).
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE')
     AND p.proname IN ('replace_recovery_codes', 'record_mfa_failure', 'account_delete_blockers');
  v_res := v_res || jsonb_build_object('16_no_anon_definer', CASE WHEN v_n = 0 THEN 'ok' ELSE 'FAIL ' || v_n END);

  SELECT jsonb_object_agg(k, v) INTO v_fail FROM jsonb_each_text(v_res) AS e(k, v) WHERE v <> 'ok';
  RAISE EXCEPTION 'RESULTS %', jsonb_build_object(
    'ok', (SELECT count(*) FROM jsonb_each_text(v_res) e(k, v) WHERE v = 'ok'),
    'total', (SELECT count(*) FROM jsonb_each_text(v_res)),
    'failures', coalesce(v_fail, '{}'::jsonb));
END $$;
