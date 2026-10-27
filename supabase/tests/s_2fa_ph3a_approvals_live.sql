-- S-2FA Ph3a — live checks for 20261027000011/12 (two-admin approval).
--
-- Leaves NOTHING behind: one DO block that ends by raising an exception with
-- the results, so every change (throwaway accounts, admin rows, requests,
-- audit rows) rolls back.
--
-- What this proves that the backend tests cannot: privileges, SECURITY DEFINER
-- + search_path, the audit row written with each request and decision, the
-- not-your-own rule, one open request per target, the 24 h expiry, the
-- requester-still-active rule and the table CHECKs.
--
-- Run: supabase db query --linked -f supabase/tests/s_2fa_ph3a_approvals_live.sql
-- Expect: ERROR  P0001: RESULTS {"ok": 22, "total": 22, "failures": {}}

DO $$
DECLARE
  v_a       CONSTANT UUID := 'a2fa3a00-0000-4000-8000-0000000000a1';  -- daily admin A
  v_b       CONSTANT UUID := 'a2fa3a00-0000-4000-8000-0000000000b2';  -- daily admin B
  v_s       CONSTANT UUID := 'a2fa3a00-0000-4000-8000-0000000000c3';  -- support
  v_t       CONSTANT UUID := 'a2fa3a00-0000-4000-8000-0000000000d4';  -- plain account (target)
  v_tag     CONSTANT UUID := 'a2fa3a00-0000-4000-8000-0000000000e5';  -- a token id (no FK)
  v_fns     CONSTANT TEXT[] := ARRAY[
    'public.admin_expire_approvals()',
    'public.admin_request_approval(uuid, text, uuid, jsonb, text, text)',
    'public.admin_decide_approval(uuid, uuid, text, text)',
    'public.admin_record_approval_result(uuid, jsonb)'];
  v_hash    CONSTANT TEXT := repeat('ab', 32);
  v_reason  CONSTANT TEXT := 'Live check: ticket 1234 review';
  v_fn      TEXT;
  v_ok      BOOLEAN;
  v_state   TEXT;
  v_id      UUID;
  v_id2     UUID;
  v_out     JSONB;
  v_res     JSONB := '{}'::jsonb;
  v_fail    JSONB;

BEGIN
  -- 01. Each function exists, SECURITY DEFINER, pinned search_path.
  v_ok := true;
  FOREACH v_fn IN ARRAY v_fns LOOP
    v_ok := v_ok AND to_regprocedure(v_fn) IS NOT NULL
      AND coalesce((SELECT p.prosecdef AND 'search_path=public, pg_temp' = ANY(p.proconfig) FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)), false);
  END LOOP;
  v_res := v_res || jsonb_build_object('01_definer_search_path', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 02. anon / authenticated / PUBLIC cannot execute them; service_role can.
  v_ok := true;
  FOREACH v_fn IN ARRAY v_fns || 'public.admin_approval_permission(text)'::text LOOP
    v_ok := v_ok
      AND NOT has_function_privilege('anon', v_fn, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       WHERE p.oid = to_regprocedure(v_fn) AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
      AND has_function_privilege('service_role', v_fn, 'EXECUTE');
  END LOOP;
  v_res := v_res || jsonb_build_object('02_service_role_only', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 03. Table: RLS on, no access for anon / authenticated.
  v_ok := (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.admin_action_approvals'::regclass)
      AND NOT has_table_privilege('anon', 'public.admin_action_approvals', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.admin_action_approvals', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.admin_action_approvals', 'INSERT')
      AND has_table_privilege('service_role', 'public.admin_action_approvals', 'SELECT');
  v_res := v_res || jsonb_build_object('03_table_locked', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 04. Only super_admin holds act_without_approval.
  v_ok := EXISTS (SELECT 1 FROM admin_roles WHERE role_name = 'super_admin' AND 'act_without_approval' = ANY(permissions::text[]))
      AND NOT EXISTS (SELECT 1 FROM admin_roles WHERE role_name <> 'super_admin' AND 'act_without_approval' = ANY(permissions::text[]));
  v_res := v_res || jsonb_build_object('04_permission_super_admin_only', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- Fixture: two daily admins, one support, one plain account.
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (v_a, 's2fa-ph3a-a@example.invalid', 'authenticated', 'authenticated'),
    (v_b, 's2fa-ph3a-b@example.invalid', 'authenticated', 'authenticated'),
    (v_s, 's2fa-ph3a-s@example.invalid', 'authenticated', 'authenticated'),
    (v_t, 's2fa-ph3a-t@example.invalid', 'authenticated', 'authenticated');
  INSERT INTO users (id, email) VALUES
    (v_a, 's2fa-ph3a-a@example.invalid'), (v_b, 's2fa-ph3a-b@example.invalid'),
    (v_s, 's2fa-ph3a-s@example.invalid'), (v_t, 's2fa-ph3a-t@example.invalid')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO admin_users (admin_id, role_id, brand, is_active)
  SELECT x.id, r.role_id, 'both', true
    FROM (VALUES (v_a, 'admin'), (v_b, 'admin'), (v_s, 'support')) AS x(id, role)
    JOIN admin_roles r ON r.role_name = x.role;

  -- 05. A requests a token suspend: returns an id, writes the audit row in the same transaction.
  v_out := admin_request_approval(v_a, 'tag_suspend', v_tag, jsonb_build_object('reason', v_reason), v_hash, v_reason);
  v_id := (v_out->>'id')::uuid;
  v_ok := v_id IS NOT NULL
      AND (v_out->>'expires_at')::timestamptz BETWEEN now() + interval '23 hours 59 minutes' AND now() + interval '24 hours 1 minute'
      AND EXISTS (SELECT 1 FROM audit_logs WHERE action = 'approval_request' AND entity_type = 'admin_approval'
                    AND entity_id = v_id AND admin_id = v_a AND changes->>'approval_action' = 'tag_suspend');
  v_res := v_res || jsonb_build_object('05_request_audited', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 06. A second open request for the same action + target is refused.
  BEGIN
    PERFORM admin_request_approval(v_b, 'tag_suspend', v_tag, jsonb_build_object('reason', v_reason), v_hash, v_reason);
    v_state := 'no error';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM;
  END;
  v_res := v_res || jsonb_build_object('06_one_open_per_target', CASE WHEN v_state LIKE 'approval_pending%' THEN 'ok' ELSE 'FAIL: ' || v_state END);

  -- 07. A short reason is refused.
  BEGIN
    PERFORM admin_request_approval(v_a, 'account_suspend', v_t, jsonb_build_object('hours', 1), v_hash, 'short');
    v_state := 'no error';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM;
  END;
  v_res := v_res || jsonb_build_object('07_reason_required', CASE WHEN v_state LIKE 'reason_required%' THEN 'ok' ELSE 'FAIL: ' || v_state END);

  -- 08. An account action on your own account is refused.
  BEGIN
    PERFORM admin_request_approval(v_a, 'account_retire', v_a, jsonb_build_object('reason', v_reason), v_hash, v_reason);
    v_state := 'no error';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM;
  END;
  v_res := v_res || jsonb_build_object('08_self_action', CASE WHEN v_state LIKE 'self_action%' THEN 'ok' ELSE 'FAIL: ' || v_state END);

  -- 09. Support (no manage_nfc) cannot request a token action.
  BEGIN
    PERFORM admin_request_approval(v_s, 'tag_reset', gen_random_uuid(), jsonb_build_object('reason', v_reason), v_hash, v_reason);
    v_state := 'no error';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM;
  END;
  v_res := v_res || jsonb_build_object('09_permission_checked', CASE WHEN v_state LIKE 'admin_forbidden%' THEN 'ok' ELSE 'FAIL: ' || v_state END);

  -- 10. The requester cannot approve their own request.
  BEGIN
    PERFORM admin_decide_approval(v_a, v_id, 'approved', NULL);
    v_state := 'no error';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM;
  END;
  v_res := v_res || jsonb_build_object('10_not_own_request', CASE WHEN v_state LIKE 'same_admin%' THEN 'ok' ELSE 'FAIL: ' || v_state END);

  -- 11. Reject needs a reason.
  BEGIN
    PERFORM admin_decide_approval(v_b, v_id, 'rejected', 'no');
    v_state := 'no error';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM;
  END;
  v_res := v_res || jsonb_build_object('11_reject_reason', CASE WHEN v_state LIKE 'reason_required%' THEN 'ok' ELSE 'FAIL: ' || v_state END);

  -- 12. Someone other than the requester may not cancel.
  BEGIN
    PERFORM admin_decide_approval(v_b, v_id, 'cancelled', NULL);
    v_state := 'no error';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM;
  END;
  v_res := v_res || jsonb_build_object('12_cancel_requester_only', CASE WHEN v_state LIKE 'not_requester%' THEN 'ok' ELSE 'FAIL: ' || v_state END);

  -- 13. B approves: the stored payload comes back, decision + audit row written.
  v_out := admin_decide_approval(v_b, v_id, 'approved', NULL);
  v_ok := v_out->>'action' = 'tag_suspend' AND (v_out->>'target_id')::uuid = v_tag
      AND v_out->'payload' = jsonb_build_object('reason', v_reason) AND v_out->>'payload_hash' = v_hash
      AND EXISTS (SELECT 1 FROM admin_action_approvals WHERE id = v_id AND decision = 'approved' AND decided_by = v_b AND decided_at IS NOT NULL)
      AND EXISTS (SELECT 1 FROM audit_logs WHERE action = 'approval_approve' AND entity_id = v_id AND admin_id = v_b);
  v_res := v_res || jsonb_build_object('13_approve_audited', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 14. A decided request cannot be decided again.
  BEGIN
    PERFORM admin_decide_approval(v_b, v_id, 'rejected', 'Changed my mind about it');
    v_state := 'no error';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM;
  END;
  v_res := v_res || jsonb_build_object('14_decided_once', CASE WHEN v_state LIKE 'approval_closed%' THEN 'ok' ELSE 'FAIL: ' || v_state END);

  -- 15. The result is recorded once.
  PERFORM admin_record_approval_result(v_id, '{"ok": true}'::jsonb);
  BEGIN
    PERFORM admin_record_approval_result(v_id, '{"ok": false}'::jsonb);
    v_state := 'no error';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM;
  END;
  v_ok := v_state LIKE 'approval_closed%'
      AND EXISTS (SELECT 1 FROM admin_action_approvals WHERE id = v_id AND executed_at IS NOT NULL AND result = '{"ok": true}'::jsonb);
  v_res := v_res || jsonb_build_object('15_result_once', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL: ' || v_state END);

  -- 16. After a decision, the same target can be asked again; the requester may cancel it.
  v_id2 := (admin_request_approval(v_a, 'tag_suspend', v_tag, jsonb_build_object('reason', v_reason), v_hash, v_reason)->>'id')::uuid;
  PERFORM admin_decide_approval(v_a, v_id2, 'cancelled', NULL);
  v_ok := EXISTS (SELECT 1 FROM admin_action_approvals WHERE id = v_id2 AND decision = 'cancelled' AND decided_by = v_a)
      AND EXISTS (SELECT 1 FROM audit_logs WHERE action = 'approval_cancel' AND entity_id = v_id2);
  v_res := v_res || jsonb_build_object('16_cancel_by_requester', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 17. An expired request cannot be approved, and does not block asking again.
  v_id2 := (admin_request_approval(v_a, 'account_suspend', v_t, jsonb_build_object('hours', 24, 'reason', v_reason), v_hash, v_reason)->>'id')::uuid;
  UPDATE admin_action_approvals SET expires_at = now() - interval '1 minute', requested_at = now() - interval '25 hours' WHERE id = v_id2;
  BEGIN
    PERFORM admin_decide_approval(v_b, v_id2, 'approved', NULL);
    v_state := 'no error';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM;
  END;
  v_id := (admin_request_approval(v_a, 'account_suspend', v_t, jsonb_build_object('hours', 24, 'reason', v_reason), v_hash, v_reason)->>'id')::uuid;
  v_ok := v_state LIKE 'approval_expired%' AND v_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM admin_action_approvals WHERE id = v_id2 AND decision = 'expired');
  v_res := v_res || jsonb_build_object('17_expiry', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL: ' || v_state END);

  -- 18. A request dies with its requester's access (A suspended).
  UPDATE users SET is_suspended = true, suspended_until = now() + interval '1 day' WHERE id = v_a;
  BEGIN
    PERFORM admin_decide_approval(v_b, v_id, 'approved', NULL);
    v_state := 'no error';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM;
  END;
  UPDATE users SET is_suspended = false, suspended_until = NULL WHERE id = v_a;
  v_res := v_res || jsonb_build_object('18_requester_inactive', CASE WHEN v_state LIKE 'requester_inactive%' THEN 'ok' ELSE 'FAIL: ' || v_state END);

  -- 19. The approver cannot run an account action on their own account (B is the target).
  v_id2 := (admin_request_approval(v_a, 'account_retire', v_b, jsonb_build_object('reason', v_reason), v_hash, v_reason)->>'id')::uuid;
  BEGIN
    PERFORM admin_decide_approval(v_b, v_id2, 'approved', NULL);
    v_state := 'no error';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM;
  END;
  v_res := v_res || jsonb_build_object('19_approver_not_target', CASE WHEN v_state LIKE 'self_action%' THEN 'ok' ELSE 'FAIL: ' || v_state END);

  -- 20. The table itself refuses a self-approval written directly.
  BEGIN
    INSERT INTO admin_action_approvals (action, target_id, payload, payload_hash, reason, requested_by, decided_by, decided_at, decision)
    VALUES ('tag_reset', gen_random_uuid(), '{}'::jsonb, v_hash, v_reason, v_a, v_a, now(), 'approved');
    v_state := 'no error';
  EXCEPTION WHEN check_violation THEN v_state := 'check_violation';
            WHEN OTHERS THEN v_state := SQLERRM;
  END;
  v_res := v_res || jsonb_build_object('20_check_not_self', CASE WHEN v_state = 'check_violation' THEN 'ok' ELSE 'FAIL: ' || v_state END);

  -- 21. Re-issue fulfil: an admin may ask (manage_nfc), support may not.
  BEGIN
    PERFORM admin_request_approval(v_s, 'reissue_fulfil', gen_random_uuid(), jsonb_build_object('reason', v_reason), v_hash, v_reason);
    v_state := 'no error';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM;
  END;
  v_id2 := (admin_request_approval(v_a, 'reissue_fulfil', gen_random_uuid(), jsonb_build_object('reason', v_reason), v_hash, v_reason)->>'id')::uuid;
  v_res := v_res || jsonb_build_object('21_reissue_fulfil', CASE WHEN v_state LIKE 'admin_forbidden%' AND v_id2 IS NOT NULL THEN 'ok' ELSE 'FAIL: ' || v_state END);

  -- 22. Lifting a hold on your own account is refused (all account_* actions).
  BEGIN
    PERFORM admin_request_approval(v_a, 'account_reactivate', v_a, jsonb_build_object('reason', v_reason), v_hash, v_reason);
    v_state := 'no error';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM;
  END;
  v_res := v_res || jsonb_build_object('22_lift_self_refused', CASE WHEN v_state LIKE 'self_action%' THEN 'ok' ELSE 'FAIL: ' || v_state END);

  SELECT jsonb_object_agg(k, v) INTO v_fail FROM jsonb_each_text(v_res) AS e(k, v) WHERE v <> 'ok';
  RAISE EXCEPTION 'RESULTS %', jsonb_build_object(
    'ok', (SELECT count(*) FROM jsonb_each_text(v_res) e(k, v) WHERE v = 'ok'),
    'total', (SELECT count(*) FROM jsonb_each_text(v_res)),
    'failures', coalesce(v_fail, '{}'::jsonb));
END $$;
