-- Account types (Collector / Creator) — live checks for 20261027000002.
--
-- Leaves NOTHING behind: one DO block that ends by raising an exception with
-- the results, so the throwaway accounts roll back.
--
-- Run: supabase db query --linked -f supabase/tests/account_types_live.sql
-- Expect: ERROR  P0001: RESULTS {"ok": 14, "total": 14, "failures": {}}

DO $$
DECLARE
  v_super CONSTANT UUID := '2b3f1532-9345-4720-8fac-55d07517c78b';  -- super_admin
  v_test  CONSTANT UUID := '0b211aed-3cf9-4729-818d-f0ed88dd68b8';  -- test@ (Yoti seller_kyc VERIFIED)
  v_test2 CONSTANT UUID := '885d30e1-4322-49a8-8363-b7926991c58d';  -- test2@ (never verified)
  v_a     CONSTANT UUID := 'a7a7a7a7-0000-4000-8000-00000000a701';  -- throwaway accounts
  v_b     CONSTANT UUID := 'a7a7a7a7-0000-4000-8000-00000000a702';
  v_ok    BOOLEAN;
  v_state TEXT;
  v_t     TEXT;
  v_ts    TIMESTAMPTZ;
  v_j     JSONB;
  v_res   JSONB := '{}'::jsonb;
BEGIN
  INSERT INTO users (id, email) VALUES
    (v_a, 'acct-type-a@example.invalid'), (v_b, 'acct-type-b@example.invalid');

  -- 01. New account defaults to collector, no request.
  SELECT account_type INTO v_t FROM users WHERE id = v_a;
  v_ok := v_t = 'collector' AND (SELECT creator_requested_at IS NULL FROM users WHERE id = v_a);
  v_res := v_res || jsonb_build_object('01_default_collector', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || coalesce(v_t, 'null') END);

  -- 02. Requested but not verified: still collector.
  v_j := request_creator_account(v_a);
  v_ok := v_j->>'account_type' = 'collector' AND v_j->>'creator_requested_at' IS NOT NULL;
  v_res := v_res || jsonb_build_object('02_request_alone_collector', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || v_j::text END);

  -- 03. Requested + VERIFIED: creator.
  UPDATE users SET seller_verification_status = 'VERIFIED' WHERE id = v_a;
  SELECT account_type INTO v_t FROM users WHERE id = v_a;
  v_res := v_res || jsonb_build_object('03_request_plus_verified_creator', CASE WHEN v_t = 'creator' THEN 'ok' ELSE 'FAIL ' || v_t END);

  -- 04. Verification revoked: back to collector; re-approved (APPROVED): creator again.
  UPDATE users SET seller_verification_status = 'REJECTED' WHERE id = v_a;
  SELECT account_type INTO v_t FROM users WHERE id = v_a;
  v_state := v_t;
  UPDATE users SET seller_verification_status = 'APPROVED' WHERE id = v_a;
  SELECT account_type INTO v_t FROM users WHERE id = v_a;
  v_state := v_state || '+' || v_t;
  v_res := v_res || jsonb_build_object('04_revoke_and_restore', CASE WHEN v_state = 'collector+creator' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 05. VERIFIED without a request (age gate / Premier check): collector.
  UPDATE users SET seller_verification_status = 'VERIFIED' WHERE id = v_b;
  SELECT account_type INTO v_t FROM users WHERE id = v_b;
  v_res := v_res || jsonb_build_object('05_verified_without_request_collector', CASE WHEN v_t = 'collector' THEN 'ok' ELSE 'FAIL ' || v_t END);

  -- 06. Writing account_type directly is overwritten (both directions).
  UPDATE users SET account_type = 'creator' WHERE id = v_b;
  SELECT account_type INTO v_t FROM users WHERE id = v_b;
  v_state := v_t;
  UPDATE users SET account_type = 'collector' WHERE id = v_a;
  SELECT account_type INTO v_t FROM users WHERE id = v_a;
  v_state := v_state || '+' || v_t;
  v_res := v_res || jsonb_build_object('06_direct_write_ignored', CASE WHEN v_state = 'collector+creator' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 07. request_creator_account keeps the first request time; unknown account refused.
  SELECT creator_requested_at INTO v_ts FROM users WHERE id = v_a;
  PERFORM request_creator_account(v_a);
  v_ok := (SELECT creator_requested_at FROM users WHERE id = v_a) = v_ts;
  v_state := 'none';
  BEGIN PERFORM request_creator_account('a7a7a7a7-0000-4000-8000-0000000000ff');
  EXCEPTION WHEN no_data_found THEN v_state := SQLERRM; END;
  v_res := v_res || jsonb_build_object('07_request_idempotent_and_unknown_refused',
    CASE WHEN v_ok AND v_state = 'account_not_found' THEN 'ok' ELSE 'FAIL ' || v_ok::text || ' ' || v_state END);

  -- 08. New functions are service_role only; the old 5-argument search is gone.
  v_ok := NOT has_function_privilege('anon', 'public.request_creator_account(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.request_creator_account(uuid)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.request_creator_account(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.admin_search_accounts(uuid, text, text, integer, integer, text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.admin_search_accounts(uuid, text, text, integer, integer, text)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.admin_search_accounts(uuid, text, text, integer, integer, text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.admin_get_account(uuid, uuid)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE')
      AND to_regprocedure('public.admin_search_accounts(uuid, text, text, integer, integer)') IS NULL;
  v_res := v_res || jsonb_build_object('08_grants', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 09. Users cannot write either new column (S-SEC column grant).
  v_ok := NOT has_column_privilege('authenticated', 'public.users', 'account_type', 'UPDATE')
      AND NOT has_column_privilege('authenticated', 'public.users', 'creator_requested_at', 'UPDATE')
      AND NOT has_column_privilege('anon', 'public.users', 'account_type', 'UPDATE');
  v_res := v_res || jsonb_build_object('09_users_cannot_write', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 10. Search type filters (v_a creator, v_b collector; then v_b requests = pending).
  PERFORM request_creator_account(v_b);
  UPDATE users SET seller_verification_status = 'NONE' WHERE id = v_b;
  v_state :=
       (admin_search_accounts(v_super, 'acct-type-', 'all', 25, 0, 'creator')->>'total')
    || '/' || (admin_search_accounts(v_super, 'acct-type-', 'all', 25, 0, 'collector')->>'total')
    || '/' || (admin_search_accounts(v_super, 'acct-type-', 'all', 25, 0, 'creator_pending')->>'total')
    || '/' || (admin_search_accounts(v_super, 'acct-type-', 'all', 25, 0, 'all')->>'total');
  v_j := admin_search_accounts(v_super, 'acct-type-a', 'all', 25, 0, 'all')->'accounts'->0;
  v_ok := v_state = '1/1/1/2' AND v_j->>'account_type' = 'creator' AND (v_j->>'creator_pending')::boolean = false;
  v_res := v_res || jsonb_build_object('10_search_type_filter', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || v_state || ' ' || coalesce(v_j::text, 'null') END);

  -- 11. Bad type refused; default (5 args via named default) still works.
  v_state := 'none';
  BEGIN PERFORM admin_search_accounts(v_super, '', 'all', 25, 0, 'staff');
  EXCEPTION WHEN check_violation THEN v_state := SQLERRM; END;
  v_ok := (admin_search_accounts(v_super, 'acct-type-', 'all', 25, 0)->>'total') = '2';
  v_res := v_res || jsonb_build_object('11_bad_type_refused_default_all',
    CASE WHEN v_state = 'invalid_type' AND v_ok THEN 'ok' ELSE 'FAIL ' || v_state || ' ' || v_ok::text END);

  -- 12. Account detail carries the type facts.
  v_j := admin_get_account(v_super, v_b);
  v_ok := v_j->>'account_type' = 'collector'
      AND v_j->>'creator_requested_at' IS NOT NULL
      AND v_j->>'creator_check_status' = 'NONE';
  v_res := v_res || jsonb_build_object('12_detail_fields', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || v_j::text END);

  -- 13. Backfill: test@ (Yoti creator check) is creator; test2@ and super_admin are collectors.
  v_state := (SELECT account_type FROM users WHERE id = v_test)
    || '/' || (SELECT account_type FROM users WHERE id = v_test2)
    || '/' || (SELECT account_type FROM users WHERE id = v_super);
  v_res := v_res || jsonb_build_object('13_backfill', CASE WHEN v_state = 'creator/collector/collector' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 14. Sign-up trigger reads the creator choice and pins search_path.
  SELECT prosrc INTO v_t FROM pg_proc WHERE oid = 'public.handle_new_user()'::regprocedure;
  v_ok := v_t LIKE '%account_intent%'
      AND (SELECT proconfig::text FROM pg_proc WHERE oid = 'public.handle_new_user()'::regprocedure) LIKE '%search_path=public%';
  v_res := v_res || jsonb_build_object('14_signup_trigger', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  RAISE EXCEPTION 'RESULTS %', (
    SELECT jsonb_build_object(
             'total', count(*),
             'ok', count(*) FILTER (WHERE value = '"ok"'::jsonb),
             'failures', coalesce(jsonb_object_agg(key, value) FILTER (WHERE value <> '"ok"'::jsonb), '{}'::jsonb))
      FROM jsonb_each(v_res));
END;
$$;
