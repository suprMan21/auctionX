-- Account types: staff change + override — live checks for 20261027000003.
--
-- Leaves NOTHING behind: one DO block that ends by raising an exception with
-- the results, so throwaway accounts and the role change roll back.
--
-- Run: supabase db query --linked -f supabase/tests/account_type_staff_live.sql
-- Expect: ERROR  P0001: RESULTS {"ok": 13, "total": 13, "failures": {}}

DO $$
DECLARE
  v_super CONSTANT UUID := '2b3f1532-9345-4720-8fac-55d07517c78b';  -- super_admin
  v_test  CONSTANT UUID := '0b211aed-3cf9-4729-818d-f0ed88dd68b8';  -- test@ (target; Yoti VERIFIED creator)
  v_staff CONSTANT UUID := '885d30e1-4322-49a8-8363-b7926991c58d';  -- test2@ (made support, then admin, here)
  v_a     CONSTANT UUID := 'a8a8a8a8-0000-4000-8000-00000000a801';  -- throwaway target, never verified
  v_fn    CONSTANT TEXT := 'public.admin_set_account_type(uuid, uuid, text, boolean, text)';
  R       CONSTANT TEXT := 'live check reason text';
  v_ok    BOOLEAN;
  v_state TEXT;
  v_j     JSONB;
  v_n     BIGINT;
  v_res   JSONB := '{}'::jsonb;
BEGIN
  INSERT INTO users (id, email) VALUES (v_a, 'acct-type-staff-a@example.invalid');

  -- 01. service_role only (and the renamed base reader too).
  v_ok := NOT has_function_privilege('anon', v_fn, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
      AND has_function_privilege('service_role', v_fn, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.admin_get_account_base(uuid, uuid)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.admin_get_account(uuid, uuid)', 'EXECUTE');
  v_res := v_res || jsonb_build_object('01_grants', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 02. Support (view only) and a non-staff account are refused.
  PERFORM admin_set_account_role(v_super, v_staff, 'support', R);
  v_state := 'none';
  BEGIN PERFORM admin_set_account_type(v_staff, v_a, 'creator', true, R);
  EXCEPTION WHEN insufficient_privilege THEN v_state := '42501'; END;
  BEGIN PERFORM admin_set_account_type(v_a, v_staff, 'creator', true, R);
  EXCEPTION WHEN insufficient_privilege THEN v_state := v_state || '+42501'; END;
  v_res := v_res || jsonb_build_object('02_support_and_user_refused', CASE WHEN v_state = '42501+42501' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 03. Own account refused; short reason refused; collector + override refused.
  v_state := '';
  BEGIN PERFORM admin_set_account_type(v_super, v_super, 'creator', false, R);
  EXCEPTION WHEN check_violation THEN v_state := SQLERRM; END;
  BEGIN PERFORM admin_set_account_type(v_super, v_a, 'creator', false, 'short');
  EXCEPTION WHEN check_violation THEN v_state := v_state || '+' || SQLERRM; END;
  BEGIN PERFORM admin_set_account_type(v_super, v_a, 'collector', true, R);
  EXCEPTION WHEN check_violation THEN v_state := v_state || '+' || SQLERRM; END;
  v_res := v_res || jsonb_build_object('03_self_reason_combo_refused',
    CASE WHEN v_state = 'cannot_act_on_self+reason_required+invalid_type' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 04. Baseline to Creator on an unverified account: still collector, pending.
  v_j := admin_set_account_type(v_super, v_a, 'creator', false, R);
  v_ok := v_j->>'account_type' = 'collector' AND (v_j->>'creator_pending')::boolean AND NOT (v_j->>'override')::boolean;
  v_res := v_res || jsonb_build_object('04_baseline_needs_check', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || v_j::text END);

  -- 05. Audit row written with the reason.
  SELECT count(*) INTO v_n FROM audit_logs
   WHERE action = 'account_type_change' AND entity_id = v_a AND admin_id = v_super AND reason = R
     AND changes->>'to' = 'collector' AND (changes->>'creator_pending')::boolean;
  v_res := v_res || jsonb_build_object('05_audited', CASE WHEN v_n = 1 THEN 'ok' ELSE 'FAIL ' || v_n END);

  -- 06. Same change again: no_change.
  v_state := 'none';
  BEGIN PERFORM admin_set_account_type(v_super, v_a, 'creator', false, R);
  EXCEPTION WHEN check_violation THEN v_state := SQLERRM; END;
  v_res := v_res || jsonb_build_object('06_no_change', CASE WHEN v_state = 'no_change' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 07. Override by an admin (not super_admin): creator at once, names who.
  PERFORM admin_set_account_role(v_super, v_staff, 'admin', R);
  v_j := admin_set_account_type(v_staff, v_a, 'creator', true, R);
  v_ok := v_j->>'account_type' = 'creator' AND (v_j->>'override')::boolean
      AND (SELECT creator_override_by FROM users WHERE id = v_a) = v_staff;
  v_res := v_res || jsonb_build_object('07_admin_override', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || v_j::text END);

  -- 08. Detail shows the override and who made it; base fields still there.
  v_j := admin_get_account(v_super, v_a);
  v_ok := v_j->>'creator_override_at' IS NOT NULL
      AND v_j->>'creator_override_by_email' = (SELECT email FROM auth.users WHERE id = v_staff)
      AND v_j->>'account_type' = 'creator'
      AND v_j ? 'pending_transfers';
  v_res := v_res || jsonb_build_object('08_detail_override', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || v_j::text END);

  -- 09. Search flags the override.
  v_j := admin_search_accounts(v_super, 'acct-type-staff-a', 'all', 25, 0, 'creator')->'accounts'->0;
  v_res := v_res || jsonb_build_object('09_search_override', CASE WHEN (v_j->>'creator_override')::boolean THEN 'ok' ELSE 'FAIL ' || coalesce(v_j::text, 'null') END);

  -- 10. Override survives a later failed identity check (staff vouched).
  UPDATE users SET seller_verification_status = 'REJECTED' WHERE id = v_a;
  v_res := v_res || jsonb_build_object('10_override_holds',
    CASE WHEN (SELECT account_type FROM users WHERE id = v_a) = 'creator' THEN 'ok' ELSE 'FAIL' END);

  -- 11. To Collector: clears request and override.
  v_j := admin_set_account_type(v_super, v_a, 'collector', false, R);
  v_ok := v_j->>'account_type' = 'collector'
      AND (SELECT creator_requested_at IS NULL AND creator_override_at IS NULL AND creator_override_by IS NULL FROM users WHERE id = v_a);
  v_res := v_res || jsonb_build_object('11_to_collector_clears', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || v_j::text END);

  -- 12. Collector -> Creator (baseline) on an already-verified account: creator at once.
  PERFORM admin_set_account_type(v_super, v_test, 'collector', false, R);
  v_j := admin_set_account_type(v_super, v_test, 'creator', false, R);
  v_ok := v_j->>'account_type' = 'creator' AND NOT (v_j->>'override')::boolean;
  v_res := v_res || jsonb_build_object('12_baseline_verified_creator', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || v_j::text END);

  -- 13. An override must name who made it.
  v_state := 'none';
  BEGIN UPDATE users SET creator_override_at = now() WHERE id = v_a;
  EXCEPTION WHEN check_violation THEN v_state := 'refused'; END;
  v_res := v_res || jsonb_build_object('13_override_needs_actor', CASE WHEN v_state = 'refused' THEN 'ok' ELSE 'FAIL ' || v_state END);

  RAISE EXCEPTION 'RESULTS %', (
    SELECT jsonb_build_object(
             'total', count(*),
             'ok', count(*) FILTER (WHERE value = '"ok"'::jsonb),
             'failures', coalesce(jsonb_object_agg(key, value) FILTER (WHERE value <> '"ok"'::jsonb), '{}'::jsonb))
      FROM jsonb_each(v_res));
END;
$$;
