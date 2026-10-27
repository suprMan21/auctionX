-- S-2FA cool-off — live checks for 20261027000009 (new-method 24 h wait).
--
-- Leaves NOTHING behind: one DO block that ends by raising an exception with
-- the results, so every change (throwaway account, grants, challenges,
-- passkey, authenticator row) rolls back.
--
-- What this proves that the backend tests cannot: the new columns really exist
-- with the right types, nullability and defaults, and the method CHECK refuses
-- a bad value while NULL (grants issued before the migration) still passes.
--
-- Run: supabase db query --linked -f supabase/tests/s_2fa_cooloff_live.sql
-- Expect: ERROR  P0001: RESULTS {"ok": 10, "total": 10, "failures": {}}

DO $$
DECLARE
  v_a     CONSTANT UUID := 'a2fa2fa2-0000-4000-8000-00000000c001';  -- throwaway account
  v_s     CONSTANT UUID := 'a2fa2fa2-0000-4000-8000-0000000c5e01';  -- its session
  v_ok    BOOLEAN;
  v_state TEXT;
  v_res   JSONB := '{}'::jsonb;
  v_fail  JSONB;
BEGIN
  -- 01. step_up_grants.method: text, nullable, no default.
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'step_up_grants' AND column_name = 'method'
                    AND data_type = 'text' AND is_nullable = 'YES' AND column_default IS NULL)
    INTO v_ok;
  v_res := v_res || jsonb_build_object('01_grant_method_column', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 02. mfa_challenges.code_confirmed: boolean, NOT NULL, default false.
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'mfa_challenges' AND column_name = 'code_confirmed'
                    AND data_type = 'boolean' AND is_nullable = 'NO' AND column_default = 'false')
    INTO v_ok;
  v_res := v_res || jsonb_build_object('02_challenge_code_confirmed_column', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 03. usable_from on both factor tables: timestamptz, nullable, no default.
  SELECT (SELECT count(*) FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name IN ('user_passkeys', 'user_totp_factors')
             AND column_name = 'usable_from' AND data_type = 'timestamp with time zone'
             AND is_nullable = 'YES' AND column_default IS NULL) = 2
    INTO v_ok;
  v_res := v_res || jsonb_build_object('03_usable_from_columns', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 04. The method CHECK exists.
  SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'step_up_grants_method_chk'
                  AND conrelid = 'public.step_up_grants'::regclass AND contype = 'c')
    INTO v_ok;
  v_res := v_res || jsonb_build_object('04_method_check_exists', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- Fixture: one auth account (handle_new_user may create the public.users row).
  INSERT INTO auth.users (id, email, aud, role)
  VALUES (v_a, 's2fa-cooloff-a@example.invalid', 'authenticated', 'authenticated');
  INSERT INTO users (id, email) VALUES (v_a, 's2fa-cooloff-a@example.invalid') ON CONFLICT (id) DO NOTHING;

  -- 05. A grant with each allowed method, and one with NULL, is accepted.
  v_state := 'ok';
  BEGIN
    INSERT INTO step_up_grants (token_hash, user_id, session_id, action, target_id, expires_at, method) VALUES
      (repeat('c1', 32), v_a, v_s, 'release', 'tag-x', now() + interval '2 minutes', 'passkey'),
      (repeat('c2', 32), v_a, v_s, 'release', 'tag-x', now() + interval '2 minutes', 'totp'),
      (repeat('c3', 32), v_a, v_s, 'factor_add', 'passkey', now() + interval '2 minutes', 'recovery_code'),
      (repeat('c4', 32), v_a, v_s, 'release', 'tag-x', now() + interval '2 minutes', NULL);
  EXCEPTION WHEN OTHERS THEN v_state := 'FAIL ' || SQLERRM; END;
  v_res := v_res || jsonb_build_object('05_good_methods_and_null_accepted', v_state);

  -- 06. A grant inserted without naming method gets NULL (old backend code keeps working).
  INSERT INTO step_up_grants (token_hash, user_id, session_id, action, target_id, expires_at)
  VALUES (repeat('c5', 32), v_a, v_s, 'release', 'tag-x', now() + interval '2 minutes');
  SELECT method IS NULL INTO v_ok FROM step_up_grants WHERE token_hash = repeat('c5', 32);
  v_res := v_res || jsonb_build_object('06_omitted_method_is_null', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 07. A bad method is refused.
  v_state := '';
  BEGIN
    INSERT INTO step_up_grants (token_hash, user_id, session_id, action, target_id, expires_at, method)
    VALUES (repeat('c6', 32), v_a, v_s, 'release', 'tag-x', now() + interval '2 minutes', 'sms');
  EXCEPTION WHEN check_violation THEN v_state := 'refused'; END;
  v_res := v_res || jsonb_build_object('07_bad_method_refused', CASE WHEN v_state = 'refused' THEN 'ok' ELSE 'FAIL' END);

  -- 08. A register challenge defaults code_confirmed to false and accepts true
  --     (mfa_challenges_shape_chk is unaffected).
  INSERT INTO mfa_challenges (user_id, session_id, purpose, challenge, expires_at)
  VALUES (v_a, v_s, 'register', 's2fa-cooloff-default', now() + interval '5 minutes');
  v_state := 'ok';
  BEGIN
    INSERT INTO mfa_challenges (user_id, session_id, purpose, challenge, expires_at, code_confirmed)
    VALUES (v_a, v_s, 'register', 's2fa-cooloff-true', now() + interval '5 minutes', true);
  EXCEPTION WHEN OTHERS THEN v_state := 'FAIL ' || SQLERRM; END;
  SELECT v_state = 'ok'
         AND (SELECT code_confirmed = false FROM mfa_challenges WHERE challenge = 's2fa-cooloff-default')
         AND (SELECT code_confirmed = true  FROM mfa_challenges WHERE challenge = 's2fa-cooloff-true')
    INTO v_ok;
  v_res := v_res || jsonb_build_object('08_code_confirmed_default_and_true', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 09. A passkey without usable_from is NULL (usable now); one with it stores it.
  INSERT INTO user_passkeys (user_id, credential_id, public_key, nickname)
  VALUES (v_a, 's2fa-cooloff-cred-0001', 'pk', 'Now');
  INSERT INTO user_passkeys (user_id, credential_id, public_key, nickname, usable_from)
  VALUES (v_a, 's2fa-cooloff-cred-0002', 'pk', 'Later', now() + interval '24 hours');
  SELECT (SELECT usable_from IS NULL FROM user_passkeys WHERE credential_id = 's2fa-cooloff-cred-0001')
     AND (SELECT usable_from > now() + interval '23 hours' FROM user_passkeys WHERE credential_id = 's2fa-cooloff-cred-0002')
    INTO v_ok;
  v_res := v_res || jsonb_build_object('09_passkey_usable_from', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 10. The authenticator row stores usable_from too.
  INSERT INTO user_totp_factors (user_id, secret_enc, usable_from)
  VALUES (v_a, 'v1.iv.tag.ct', now() + interval '24 hours');
  SELECT usable_from > now() + interval '23 hours' INTO v_ok FROM user_totp_factors WHERE user_id = v_a;
  v_res := v_res || jsonb_build_object('10_totp_usable_from', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  SELECT jsonb_object_agg(k, v) INTO v_fail FROM jsonb_each_text(v_res) AS e(k, v) WHERE v <> 'ok';
  RAISE EXCEPTION 'RESULTS %', jsonb_build_object(
    'ok', (SELECT count(*) FROM jsonb_each_text(v_res) e(k, v) WHERE v = 'ok'),
    'total', (SELECT count(*) FROM jsonb_each_text(v_res)),
    'failures', coalesce(v_fail, '{}'::jsonb));
END $$;
