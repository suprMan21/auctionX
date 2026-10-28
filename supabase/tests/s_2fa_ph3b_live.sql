-- S-2FA Ph3b — live checks for 20261027000013 (email-code recovery, backup email).
--
-- Leaves NOTHING behind: one DO block that ends by raising an exception with
-- the results, so every change rolls back.
--
-- What this proves that the backend tests cannot: privileges, SECURITY DEFINER
-- + search_path, RLS, the CHECKs, the send limits and attempt counting under
-- row locks, the hold / finish / freeze / undo state machine, and that finish
-- voids the old backup codes and marks the session in the same transaction.
--
-- now() is fixed inside one transaction, so time is moved by updating the
-- rows (created_at, hold_ends_at, expires_at), never by waiting.
--
-- Run: supabase db query --linked -f supabase/tests/s_2fa_ph3b_live.sql
-- Expect: ERROR  P0001: RESULTS {"ok": 24, "total": 24, "failures": {}}

DO $$
DECLARE
  v_u       CONSTANT UUID := 'a2fa3b00-0000-4000-8000-0000000000a1';  -- the account
  v_s1      CONSTANT UUID := 'a2fa3b00-0000-4000-8000-0000000000c1';  -- recovering session
  v_s2      CONSTANT UUID := 'a2fa3b00-0000-4000-8000-0000000000c2';  -- another session
  v_fns     CONSTANT TEXT[] := ARRAY[
    'public.issue_email_code(uuid, uuid, uuid, text, text, text, text, timestamp with time zone)',
    'public.use_email_code(uuid, uuid, uuid, text, text, text)',
    'public.start_account_recovery(uuid, uuid, text, integer)',
    'public.finish_account_recovery(uuid, uuid, integer, integer)',
    'public.cancel_account_recovery(uuid)',
    'public.claim_recovery_enrolment(uuid, uuid)',
    'public.release_recovery_enrolment(uuid, uuid)',
    'public.undo_account_recovery(uuid, uuid)'];
  v_tables  CONSTANT TEXT[] := ARRAY['public.user_backup_emails', 'public.email_codes', 'public.account_recoveries'];
  v_n1      CONSTANT TEXT := repeat('1a', 32);   -- nonce hash
  v_n2      CONSTANT TEXT := repeat('2b', 32);
  v_h       CONSTANT TEXT := repeat('3c', 32);   -- the right code hash
  v_bad     CONSTANT TEXT := repeat('4d', 32);   -- a wrong one
  v_exp     TIMESTAMPTZ := now() + interval '10 minutes';
  v_fn      TEXT;
  v_t       TEXT;
  v_ok      BOOLEAN;
  v_state   TEXT;
  v_c1      UUID := gen_random_uuid();
  v_c2      UUID := gen_random_uuid();
  v_c3      UUID := gen_random_uuid();
  v_rec     UUID;
  v_id      UUID;
  v_old_pk  UUID;
  v_new_pk  UUID;
  v_out     JSONB;
  v_res     JSONB := '{}'::jsonb;
  v_fail    JSONB;
BEGIN
  -- 01. Each function exists, SECURITY DEFINER, search_path public, pg_temp.
  v_ok := true;
  FOREACH v_fn IN ARRAY v_fns LOOP
    v_ok := v_ok AND to_regprocedure(v_fn) IS NOT NULL
      AND coalesce((SELECT p.prosecdef AND 'search_path=public, pg_temp' = ANY(p.proconfig) FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)), false);
  END LOOP;
  v_res := v_res || jsonb_build_object('01_definer_search_path', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 02. anon / authenticated / PUBLIC cannot execute them; service_role can.
  v_ok := true;
  FOREACH v_fn IN ARRAY v_fns || 'public.account_delete_blockers(uuid)'::text LOOP
    v_ok := v_ok
      AND NOT has_function_privilege('anon', v_fn, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       WHERE p.oid = to_regprocedure(v_fn) AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
      AND has_function_privilege('service_role', v_fn, 'EXECUTE');
  END LOOP;
  v_res := v_res || jsonb_build_object('02_service_role_only', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 03. Tables: RLS on, no policies, no access for anon / authenticated.
  v_ok := true;
  FOREACH v_t IN ARRAY v_tables LOOP
    v_ok := v_ok
      AND (SELECT relrowsecurity FROM pg_class WHERE oid = v_t::regclass)
      AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname || '.' || tablename = v_t)
      AND NOT has_table_privilege('anon', v_t, 'SELECT') AND NOT has_table_privilege('authenticated', v_t, 'SELECT')
      AND NOT has_table_privilege('anon', v_t, 'INSERT') AND NOT has_table_privilege('authenticated', v_t, 'INSERT')
      AND has_table_privilege('service_role', v_t, 'SELECT');
  END LOOP;
  v_res := v_res || jsonb_build_object('03_rls_no_client_access', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- Fixture: one account with an old passkey and 10 backup codes.
  INSERT INTO auth.users (id, email, aud, role) VALUES (v_u, 's2fa-ph3b@example.invalid', 'authenticated', 'authenticated');
  INSERT INTO users (id, email) VALUES (v_u, 's2fa-ph3b@example.invalid') ON CONFLICT (id) DO NOTHING;
  INSERT INTO user_passkeys (user_id, credential_id, public_key, nickname)
  VALUES (v_u, 'oldoldoldoldold0000', 'pk', 'Old key') RETURNING id INTO v_old_pk;
  PERFORM replace_recovery_codes(v_u, ARRAY(SELECT md5(g::text) || md5(g::text) FROM generate_series(1, 10) g));

  -- 04. First send ok; an immediate second send hits the 60 s cooldown.
  v_out := issue_email_code(v_c1, v_u, v_s1, v_n1, 'recovery_start', 'primary', v_h, v_exp);
  v_state := v_out->>'status';
  v_out := issue_email_code(v_c2, v_u, v_s1, v_n1, 'recovery_start', 'primary', v_h, v_exp);
  v_res := v_res || jsonb_build_object('04_cooldown', CASE WHEN v_state = 'ok' AND v_out->>'status' = 'cooldown'
    AND NOT EXISTS (SELECT 1 FROM email_codes WHERE id = v_c2) THEN 'ok' ELSE 'FAIL: ' || v_state || '/' || (v_out->>'status') END);

  -- 05. After the cooldown, a new send of the same purpose voids the live one.
  UPDATE email_codes SET created_at = now() - interval '2 minutes' WHERE user_id = v_u;
  v_out := issue_email_code(v_c2, v_u, v_s1, v_n1, 'recovery_start', 'primary', v_h, v_exp);
  v_res := v_res || jsonb_build_object('05_new_send_voids_old', CASE WHEN v_out->>'status' = 'ok'
    AND (SELECT voided_at IS NOT NULL FROM email_codes WHERE id = v_c1)
    AND (SELECT voided_at IS NULL FROM email_codes WHERE id = v_c2) THEN 'ok' ELSE 'FAIL' END);

  -- 06. Three sends in the last hour: the fourth is refused.
  UPDATE email_codes SET created_at = now() - interval '5 minutes' WHERE user_id = v_u;
  v_out := issue_email_code(v_c3, v_u, v_s1, v_n1, 'backup_email_verify', 'backup', v_h, v_exp);
  UPDATE email_codes SET created_at = created_at - interval '2 minutes' WHERE user_id = v_u;
  v_out := issue_email_code(gen_random_uuid(), v_u, v_s1, v_n1, 'backup_email_verify', 'backup', v_h, v_exp);
  v_res := v_res || jsonb_build_object('06_hour_limit', CASE WHEN v_out->>'status' = 'hour_limit' THEN 'ok' ELSE 'FAIL: ' || (v_out->>'status') END);

  -- 07. Another session or another nonce: invalid, and no attempt counted.
  v_out := use_email_code(v_c2, v_u, v_s2, v_n1, 'recovery_start', v_h);
  v_state := v_out->>'result';
  v_out := use_email_code(v_c2, v_u, v_s1, v_n2, 'recovery_start', v_h);
  v_res := v_res || jsonb_build_object('07_bound_to_session_and_nonce', CASE WHEN v_state = 'invalid' AND v_out->>'result' = 'invalid'
    AND (SELECT attempts FROM email_codes WHERE id = v_c2) = 0 THEN 'ok' ELSE 'FAIL' END);

  -- 08. Wrong purpose: invalid.
  v_out := use_email_code(v_c2, v_u, v_s1, v_n1, 'recovery_finish', v_h);
  v_res := v_res || jsonb_build_object('08_bound_to_purpose', CASE WHEN v_out->>'result' = 'invalid' THEN 'ok' ELSE 'FAIL' END);

  -- 09. Four wrong, the fifth wrong locks, then even the right code is refused.
  FOR i IN 1..4 LOOP
    v_out := use_email_code(v_c3, v_u, v_s1, v_n1, 'backup_email_verify', v_bad);
  END LOOP;
  v_state := v_out->>'result';
  v_out := use_email_code(v_c3, v_u, v_s1, v_n1, 'backup_email_verify', v_bad);
  v_state := v_state || '/' || (v_out->>'result');
  v_out := use_email_code(v_c3, v_u, v_s1, v_n1, 'backup_email_verify', v_h);
  v_res := v_res || jsonb_build_object('09_five_attempts', CASE WHEN v_state = 'wrong/locked' AND v_out->>'result' = 'locked'
    AND (SELECT attempts FROM email_codes WHERE id = v_c3) = 5 THEN 'ok' ELSE 'FAIL: ' || v_state || '/' || (v_out->>'result') END);

  -- 10. The right code: ok + channel; again: expired (single use).
  v_out := use_email_code(v_c2, v_u, v_s1, v_n1, 'recovery_start', v_h);
  v_state := (v_out->>'result') || ':' || (v_out->>'channel');
  v_out := use_email_code(v_c2, v_u, v_s1, v_n1, 'recovery_start', v_h);
  v_res := v_res || jsonb_build_object('10_single_use', CASE WHEN v_state = 'ok:primary' AND v_out->>'result' = 'expired' THEN 'ok' ELSE 'FAIL: ' || v_state END);

  -- 11. An expired code: expired.
  DELETE FROM email_codes WHERE user_id = v_u;
  PERFORM issue_email_code(v_c1, v_u, v_s1, v_n1, 'recovery_finish', 'primary', v_h, now() - interval '1 second');
  v_out := use_email_code(v_c1, v_u, v_s1, v_n1, 'recovery_finish', v_h);
  v_res := v_res || jsonb_build_object('11_expiry', CASE WHEN v_out->>'result' = 'expired' THEN 'ok' ELSE 'FAIL' END);

  -- 12. Start: 72 h hold; a second start while one waits: busy.
  v_out := start_account_recovery(v_u, v_s1, 'primary', 72);
  v_rec := (v_out->>'id')::uuid;
  v_state := v_out->>'status';
  v_out := start_account_recovery(v_u, v_s1, 'primary', 72);
  v_res := v_res || jsonb_build_object('12_start_then_busy', CASE WHEN v_state = 'ok' AND v_out->>'status' = 'busy'
    AND (SELECT hold_ends_at = now() + interval '72 hours' FROM account_recoveries WHERE id = v_rec) THEN 'ok' ELSE 'FAIL' END);

  -- 13. Only one waiting recovery per account, even written directly.
  BEGIN
    INSERT INTO account_recoveries (user_id, channel, started_session_id, hold_ends_at) VALUES (v_u, 'primary', v_s2, now());
    v_state := 'inserted';
  EXCEPTION WHEN unique_violation THEN v_state := 'refused';
  END;
  v_res := v_res || jsonb_build_object('13_one_holding', CASE WHEN v_state = 'refused' THEN 'ok' ELSE 'FAIL' END);

  -- 14. Finish before the hold ends: not_ready, nothing changed.
  v_out := finish_account_recovery(v_u, v_s1, 7, 30);
  v_res := v_res || jsonb_build_object('14_not_ready', CASE WHEN v_out->>'status' = 'not_ready'
    AND (SELECT count(*) FROM user_recovery_codes WHERE user_id = v_u) = 10 THEN 'ok' ELSE 'FAIL' END);

  -- 15. Cancel: cancelled; a new start is then allowed.
  v_id := cancel_account_recovery(v_u);
  v_out := start_account_recovery(v_u, v_s1, 'primary', 72);
  v_res := v_res || jsonb_build_object('15_cancel', CASE WHEN v_id = v_rec
    AND (SELECT status FROM account_recoveries WHERE id = v_rec) = 'cancelled' AND v_out->>'status' = 'ok' THEN 'ok' ELSE 'FAIL' END);
  v_rec := (v_out->>'id')::uuid;

  -- 16. Finish after the hold: completed, 7-day freeze, old codes gone, this session marked.
  UPDATE account_recoveries SET hold_ends_at = now() - interval '1 second' WHERE id = v_rec;
  v_out := finish_account_recovery(v_u, v_s1, 7, 30);
  v_res := v_res || jsonb_build_object('16_finish', CASE WHEN v_out->>'status' = 'ok'
    AND (SELECT status = 'completed' AND freeze_ends_at = now() + interval '7 days' AND enrol_until = now() + interval '30 minutes'
           FROM account_recoveries WHERE id = v_rec)
    AND (SELECT count(*) FROM user_recovery_codes WHERE user_id = v_u) = 0
    AND (SELECT method FROM mfa_sessions WHERE session_id = v_s1) = 'email_recovery' THEN 'ok' ELSE 'FAIL' END);

  -- 17. During the freeze no new recovery starts.
  v_out := start_account_recovery(v_u, v_s2, 'primary', 72);
  v_res := v_res || jsonb_build_object('17_frozen', CASE WHEN v_out->>'status' = 'frozen' THEN 'ok' ELSE 'FAIL' END);

  -- 18. Enrolment: another session gets nothing; the finishing session gets it once.
  v_id := claim_recovery_enrolment(v_u, v_s2);
  v_state := coalesce(v_id::text, 'null');
  v_id := claim_recovery_enrolment(v_u, v_s1);
  v_res := v_res || jsonb_build_object('18_claim_once', CASE WHEN v_state = 'null' AND v_id = v_rec
    AND claim_recovery_enrolment(v_u, v_s1) IS NULL THEN 'ok' ELSE 'FAIL' END);

  -- 19. Release gives it back only while nothing was added.
  PERFORM release_recovery_enrolment(v_u, v_rec);
  v_ok := (SELECT enrolled_at IS NULL FROM account_recoveries WHERE id = v_rec);
  v_id := claim_recovery_enrolment(v_u, v_s1);
  INSERT INTO user_passkeys (user_id, credential_id, public_key, nickname, added_by_recovery)
  VALUES (v_u, 'newnewnewnewnew0000', 'pk', 'New key', v_rec) RETURNING id INTO v_new_pk;
  PERFORM release_recovery_enrolment(v_u, v_rec);
  v_res := v_res || jsonb_build_object('19_release', CASE WHEN v_ok
    AND (SELECT enrolled_at IS NOT NULL FROM account_recoveries WHERE id = v_rec) THEN 'ok' ELSE 'FAIL' END);

  -- 20. Undo: the added passkey goes, the old one stays, recovery markers end; twice = none.
  v_out := undo_account_recovery(v_u, v_rec);
  v_res := v_res || jsonb_build_object('20_undo', CASE WHEN v_out->>'status' = 'ok' AND (v_out->>'passkeys_removed')::int = 1
    AND NOT EXISTS (SELECT 1 FROM user_passkeys WHERE id = v_new_pk)
    AND EXISTS (SELECT 1 FROM user_passkeys WHERE id = v_old_pk)
    AND NOT EXISTS (SELECT 1 FROM mfa_sessions WHERE user_id = v_u AND method = 'email_recovery')
    AND (SELECT status FROM account_recoveries WHERE id = v_rec) = 'undone'
    AND undo_account_recovery(v_u, v_rec)->>'status' = 'none' THEN 'ok' ELSE 'FAIL' END);

  -- 21. Undo is refused once the freeze is over.
  UPDATE account_recoveries SET status = 'completed', undone_at = NULL, freeze_ends_at = now() - interval '1 second' WHERE id = v_rec;
  v_res := v_res || jsonb_build_object('21_no_undo_after_freeze',
    CASE WHEN undo_account_recovery(v_u, v_rec)->>'status' = 'none' THEN 'ok' ELSE 'FAIL' END);

  -- 22. CHECKs: old values still accepted, new values accepted, junk refused.
  v_ok := true;
  INSERT INTO mfa_sessions (session_id, user_id, method, expires_at) VALUES (gen_random_uuid(), v_u, 'recovery_code', now() + interval '1 hour');
  INSERT INTO mfa_sessions (session_id, user_id, method, expires_at) VALUES (gen_random_uuid(), v_u, 'email_recovery', now() + interval '1 hour');
  INSERT INTO step_up_grants (token_hash, user_id, session_id, action, target_id, expires_at)
  VALUES (repeat('5e', 32), v_u, v_s1, 'recovery_undo', 'x', now()), (repeat('6f', 32), v_u, v_s1, 'release', 'x', now()),
         (repeat('7a', 32), v_u, v_s1, 'recovery_channel', 'backup_email', now());
  BEGIN
    INSERT INTO email_codes (id, user_id, session_id, nonce_hash, purpose, channel, code_hash, expires_at)
    VALUES (gen_random_uuid(), v_u, v_s1, v_n1, 'sign_in', 'primary', v_h, now());
    v_ok := false;
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO step_up_grants (token_hash, user_id, session_id, action, target_id, expires_at)
    VALUES (repeat('8b', 32), v_u, v_s1, 'anything', 'x', now());
    v_ok := false;
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  v_res := v_res || jsonb_build_object('22_checks', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 23. Backup email must be stored lower-case and trimmed.
  BEGIN
    INSERT INTO user_backup_emails (user_id, email) VALUES (v_u, 'Mixed@Example.org');
    v_state := 'inserted';
  EXCEPTION WHEN check_violation THEN v_state := 'refused';
  END;
  INSERT INTO user_backup_emails (user_id, email) VALUES (v_u, 'backup@example.org');
  v_res := v_res || jsonb_build_object('23_backup_email_check', CASE WHEN v_state = 'refused' THEN 'ok' ELSE 'FAIL' END);

  -- 24. These rows never block Delete: account_delete_blockers on a retired
  --     account that has only them reports nothing about history.
  UPDATE users SET retired_at = now() - interval '30 days' WHERE id = v_u;
  DELETE FROM user_recovery_codes WHERE user_id = v_u;
  v_res := v_res || jsonb_build_object('24_delete_not_blocked',
    CASE WHEN NOT ('account_has_history' = ANY(account_delete_blockers(v_u))) THEN 'ok'
         ELSE 'FAIL: ' || array_to_string(account_delete_blockers(v_u), ',') END);

  SELECT jsonb_object_agg(k, v) INTO v_fail FROM jsonb_each_text(v_res) AS e(k, v) WHERE v <> 'ok';
  RAISE EXCEPTION 'RESULTS %', jsonb_build_object(
    'ok', (SELECT count(*) FROM jsonb_each_text(v_res) e(k, v) WHERE v = 'ok'),
    'total', (SELECT count(*) FROM jsonb_each_text(v_res)),
    'failures', coalesce(v_fail, '{}'::jsonb));
END $$;
