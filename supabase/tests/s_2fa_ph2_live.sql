-- S-2FA Ph2 — live checks for 20261027000008 (mfa_end_other_sessions).
--
-- Leaves NOTHING behind: one DO block that ends by raising an exception with
-- the results, so every change (throwaway auth accounts, sessions, refresh
-- tokens, markers) rolls back.
--
-- What this proves that the backend tests cannot: the function's privileges,
-- SECURITY DEFINER + search_path, and that it really deletes the account's
-- other auth.sessions / auth.refresh_tokens / mfa_sessions while keeping the
-- named session and never touching another account.
--
-- Run: supabase db query --linked -f supabase/tests/s_2fa_ph2_live.sql
-- Expect: ERROR  P0001: RESULTS {"ok": 9, "total": 9, "failures": {}}

DO $$
DECLARE
  v_a      CONSTANT UUID := 'a2fa2fa2-0000-4000-8000-00000000b201';  -- throwaway accounts
  v_b      CONSTANT UUID := 'a2fa2fa2-0000-4000-8000-00000000b202';
  v_keep   CONSTANT UUID := 'a2fa2fa2-0000-4000-8000-0000000b5e01';  -- a's current session
  v_other  CONSTANT UUID := 'a2fa2fa2-0000-4000-8000-0000000b5e02';  -- a's other session
  v_bs     CONSTANT UUID := 'a2fa2fa2-0000-4000-8000-0000000b5e03';  -- b's session
  v_fn     CONSTANT TEXT := 'public.mfa_end_other_sessions(uuid, uuid)';
  v_ok     BOOLEAN;
  v_state  TEXT;
  v_n      INTEGER;
  v_res    JSONB := '{}'::jsonb;
  v_fail   JSONB;
BEGIN
  -- 01. Exists, SECURITY DEFINER, pinned search_path.
  SELECT to_regprocedure(v_fn) IS NOT NULL
         AND coalesce((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)), false)
         AND coalesce((SELECT 'search_path=public' = ANY(p.proconfig) FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)), false)
    INTO v_ok;
  v_res := v_res || jsonb_build_object('01_definer_search_path', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 02. anon / authenticated / PUBLIC cannot execute it; service_role can.
  v_ok := NOT has_function_privilege('anon', v_fn, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       WHERE p.oid = to_regprocedure(v_fn) AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
      AND has_function_privilege('service_role', v_fn, 'EXECUTE');
  v_res := v_res || jsonb_build_object('02_service_role_only', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- Fixture: two auth accounts (handle_new_user may create the public.users rows).
  INSERT INTO auth.users (id, email, aud, role)
  VALUES (v_a, 's2fa-ph2-a@example.invalid', 'authenticated', 'authenticated'),
         (v_b, 's2fa-ph2-b@example.invalid', 'authenticated', 'authenticated');
  INSERT INTO users (id, email) VALUES (v_a, 's2fa-ph2-a@example.invalid'), (v_b, 's2fa-ph2-b@example.invalid')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO auth.sessions (id, user_id) VALUES (v_keep, v_a), (v_other, v_a), (v_bs, v_b);
  INSERT INTO auth.refresh_tokens (token, user_id, session_id, revoked) VALUES
    ('s2fa-ph2-keep',   v_a::text, v_keep,  false),
    ('s2fa-ph2-other',  v_a::text, v_other, false),
    ('s2fa-ph2-legacy', v_a::text, NULL,    false),
    ('s2fa-ph2-b',      v_b::text, v_bs,    false);
  INSERT INTO mfa_sessions (session_id, user_id, method, expires_at) VALUES
    (v_keep, v_a, 'passkey', now() + interval '1 hour'),
    (v_other, v_a, 'totp', now() + interval '1 hour'),
    (v_bs, v_b, 'passkey', now() + interval '1 hour');
  INSERT INTO step_up_grants (token_hash, user_id, session_id, action, target_id, expires_at) VALUES
    (repeat('a1', 32), v_a, v_keep,  'release', 'tag-x', now() + interval '2 minutes'),
    (repeat('a2', 32), v_a, v_other, 'release', 'tag-x', now() + interval '2 minutes');

  -- 03. NULL keep-session is refused (never "end everything" by accident).
  v_state := '';
  BEGIN PERFORM mfa_end_other_sessions(v_a, NULL);
  EXCEPTION WHEN check_violation THEN v_state := 'refused'; END;
  v_res := v_res || jsonb_build_object('03_null_keep_refused', CASE WHEN v_state = 'refused' THEN 'ok' ELSE 'FAIL' END);

  v_n := mfa_end_other_sessions(v_a, v_keep);

  -- 04. Returns the number of auth sessions ended.
  v_res := v_res || jsonb_build_object('04_returns_count', CASE WHEN v_n = 1 THEN 'ok' ELSE 'FAIL ' || v_n END);

  -- 05. The kept session survives; the other one is gone.
  v_ok := EXISTS (SELECT 1 FROM auth.sessions WHERE id = v_keep)
      AND NOT EXISTS (SELECT 1 FROM auth.sessions WHERE id = v_other);
  v_res := v_res || jsonb_build_object('05_sessions', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 06. Refresh tokens: kept session's stays; other session's and session-less ones go.
  v_ok := EXISTS (SELECT 1 FROM auth.refresh_tokens WHERE token = 's2fa-ph2-keep')
      AND NOT EXISTS (SELECT 1 FROM auth.refresh_tokens WHERE token IN ('s2fa-ph2-other', 's2fa-ph2-legacy'));
  v_res := v_res || jsonb_build_object('06_refresh_tokens', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 07. Markers: kept session's stays; the other's goes.
  v_ok := EXISTS (SELECT 1 FROM mfa_sessions WHERE session_id = v_keep)
      AND NOT EXISTS (SELECT 1 FROM mfa_sessions WHERE session_id = v_other);
  v_res := v_res || jsonb_build_object('07_markers', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 08. Unused grants of other sessions go; the kept session's stays.
  v_ok := EXISTS (SELECT 1 FROM step_up_grants WHERE token_hash = repeat('a1', 32))
      AND NOT EXISTS (SELECT 1 FROM step_up_grants WHERE token_hash = repeat('a2', 32));
  v_res := v_res || jsonb_build_object('08_grants', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 09. Another account is untouched.
  v_ok := EXISTS (SELECT 1 FROM auth.sessions WHERE id = v_bs)
      AND EXISTS (SELECT 1 FROM auth.refresh_tokens WHERE token = 's2fa-ph2-b')
      AND EXISTS (SELECT 1 FROM mfa_sessions WHERE session_id = v_bs);
  v_res := v_res || jsonb_build_object('09_other_account_untouched', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  SELECT jsonb_object_agg(k, v) INTO v_fail FROM jsonb_each_text(v_res) AS e(k, v) WHERE v <> 'ok';
  RAISE EXCEPTION 'RESULTS %', jsonb_build_object(
    'ok', (SELECT count(*) FROM jsonb_each_text(v_res) e(k, v) WHERE v = 'ok'),
    'total', (SELECT count(*) FROM jsonb_each_text(v_res)),
    'failures', coalesce(v_fail, '{}'::jsonb));
END $$;
