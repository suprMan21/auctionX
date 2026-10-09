-- S-ADMIN1 Ph2 — live checks of admin_review_reissue / admin_fulfil_reissue on staging.
--
-- Leaves NOTHING behind: the whole run is one DO block that ends by raising an
-- exception carrying the results, so every seed row, audit row and the temporary
-- failure trigger roll back. (Ph1 left its seed rows in staging; this does not.)
--
-- Run: supabase db query --linked -f supabase/tests/s_admin1_ph2_live.sql
-- Expect: ERROR  P0001: RESULTS {...} with every check "ok".

DO $$
DECLARE
  v_owner    CONSTANT UUID := '0b211aed-3cf9-4729-818d-f0ed88dd68b8';  -- test@
  v_other    CONSTANT UUID := '885d30e1-4322-49a8-8363-b7926991c58d';  -- test2@ (no manage_nfc)
  v_admin    CONSTANT UUID := '2b3f1532-9345-4720-8fac-55d07517c78b';  -- super_admin (manage_nfc)
  v_reason   CONSTANT TEXT := 'Live check S-ADMIN1 Ph2, rolled back';
  v_old      UUID := gen_random_uuid();
  v_new      UUID := gen_random_uuid();
  v_spare    UUID := gen_random_uuid();
  v_req      UUID := gen_random_uuid();
  v_req2     UUID := gen_random_uuid();
  v_req3     UUID := gen_random_uuid();
  v_custody  UUID := gen_random_uuid();
  v_oid      TEXT := '0x' || encode(gen_random_bytes(32), 'hex');
  v_res      JSONB := '{}'::jsonb;
  v_err      TEXT;
  v_row      RECORD;
  v_n        INT;
  v_ok       BOOLEAN;

  -- Records "ok" when the error message starts with the expected prefix.
  -- (plpgsql has no closures; each check below repeats the small pattern.)
BEGIN
  -- ── Seed: v2 chips (unique serials, so no UID collisions) ────────────────
  INSERT INTO nfc_tags (id, tag_uid, chip_serial, sdm_key_version, seller_id, lifecycle_status, current_owner_id, status, metadata)
  VALUES
    (v_old,   'FFAD00000PH2OLD', upper(encode(gen_random_bytes(8), 'hex')), 2, v_admin, 'ACTIVE',   v_owner, 'active',     '{"test":"s-admin1-ph2"}'),
    (v_new,   'FFAD00000PH2NEW', upper(encode(gen_random_bytes(8), 'hex')), 2, v_admin, 'ENROLLED', NULL,    'registered', '{"test":"s-admin1-ph2"}'),
    (v_spare, 'FFAD0000PH2SPAR', upper(encode(gen_random_bytes(8), 'hex')), 2, v_admin, 'ACTIVE',   v_owner, 'active',     '{"test":"s-admin1-ph2"}');

  INSERT INTO reissue_requests (id, tag_id, requester_id, status, list_amount_usd_cents, charged_amount, charged_currency, fx_rate, photo_keys)
  VALUES (v_req, v_old, v_owner, 'PENDING', 1000, 1000, 'usd', 1, ARRAY['reissue-evidence/x/a.jpg']);

  -- 1. Non-admin actor is refused by the function itself.
  BEGIN
    PERFORM admin_review_reissue(v_req, v_other, true, false, v_reason);
    v_res := v_res || jsonb_build_object('01_non_admin_refused', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('01_non_admin_refused',
      CASE WHEN SQLSTATE = '42501' AND SQLERRM LIKE 'admin_forbidden%' THEN 'ok' ELSE 'FAIL: ' || SQLSTATE || ' ' || SQLERRM END);
  END;

  -- 2. Short reason refused.
  BEGIN
    PERFORM admin_review_reissue(v_req, v_admin, true, false, 'short');
    v_res := v_res || jsonb_build_object('02_reason_required', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('02_reason_required', CASE WHEN SQLERRM LIKE 'reason_required%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- 3. Approval refused when the requester no longer owns the token.
  BEGIN
    UPDATE nfc_tags SET current_owner_id = v_other WHERE id = v_old;
    PERFORM admin_review_reissue(v_req, v_admin, true, false, v_reason);
    v_res := v_res || jsonb_build_object('03_requester_not_owner', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('03_requester_not_owner', CASE WHEN SQLERRM LIKE 'requester_not_owner%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;
  SELECT current_owner_id = v_owner INTO v_ok FROM nfc_tags WHERE id = v_old;
  v_res := v_res || jsonb_build_object('03b_owner_change_rolled_back', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 4. Approve (charge): APPROVED + AWAITING_PAYMENT, audit row written inside.
  PERFORM admin_review_reissue(v_req, v_admin, true, false, v_reason);
  SELECT status, payment_status, reviewed_by INTO v_row FROM reissue_requests WHERE id = v_req;
  SELECT count(*) INTO v_n FROM audit_logs WHERE entity_id = v_req AND action = 'reissue_approve';
  v_res := v_res || jsonb_build_object('04_approve',
    CASE WHEN v_row.status = 'APPROVED' AND v_row.payment_status = 'AWAITING_PAYMENT' AND v_row.reviewed_by = v_admin AND v_n = 1
         THEN 'ok' ELSE 'FAIL: ' || row_to_json(v_row)::text || ' audit=' || v_n END);

  -- 5. A second decision on the same request is refused.
  BEGIN
    PERFORM admin_review_reissue(v_req, v_admin, false, false, v_reason);
    v_res := v_res || jsonb_build_object('05_no_second_decision', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('05_no_second_decision', CASE WHEN SQLERRM LIKE 'request_invalid_state%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- 6. Fulfil refused while unpaid (Boss: nothing goes through unpaid).
  BEGIN
    PERFORM admin_fulfil_reissue(v_req, v_new, v_admin, v_reason, v_custody, v_oid, 'tagref', 'saltenc');
    v_res := v_res || jsonb_build_object('06_fulfil_unpaid_refused', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('06_fulfil_unpaid_refused', CASE WHEN SQLERRM LIKE 'not_paid%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- 7. The table itself refuses a fulfilled-but-unpaid row (defence in depth).
  BEGIN
    UPDATE reissue_requests SET fulfilled_at = now() WHERE id = v_req;
    RAISE EXCEPTION 'accepted_but_must_be_refused';
  EXCEPTION WHEN check_violation THEN
    v_res := v_res || jsonb_build_object('07_check_fulfil_paid', CASE WHEN SQLERRM LIKE '%reissue_requests_fulfil_paid_chk%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('07_check_fulfil_paid', 'FAIL: ' || SQLERRM);
  END;

  -- 7b. Same with NO payment state at all (a NULL CHECK would pass; 20261009000002).
  BEGIN
    UPDATE reissue_requests SET payment_status = NULL, fulfilled_at = now() WHERE id = v_req;
    RAISE EXCEPTION 'accepted_but_must_be_refused';
  EXCEPTION WHEN check_violation THEN
    v_res := v_res || jsonb_build_object('07b_check_fulfil_null_payment', 'ok');
  WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('07b_check_fulfil_null_payment', 'FAIL: ' || SQLERRM);
  END;

  -- 8. A waiver always carries a reason (NULL included; 20261009000002).
  BEGIN
    UPDATE reissue_requests SET payment_status = 'WAIVED', waive_reason = NULL WHERE id = v_req;
    RAISE EXCEPTION 'accepted_but_must_be_refused';
  EXCEPTION WHEN check_violation THEN
    v_res := v_res || jsonb_build_object('08_check_waive_reason', CASE WHEN SQLERRM LIKE '%reissue_requests_waive_reason_chk%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('08_check_waive_reason', 'FAIL: ' || SQLERRM);
  END;

  -- 9. One open request per tag (APPROVED-unfulfilled counts as open).
  BEGIN
    INSERT INTO reissue_requests (tag_id, requester_id, status) VALUES (v_old, v_owner, 'PENDING');
    RAISE EXCEPTION 'accepted_but_must_be_refused';
  EXCEPTION WHEN unique_violation THEN
    v_res := v_res || jsonb_build_object('09_one_open_per_tag', 'ok');
  WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('09_one_open_per_tag', 'FAIL: ' || SQLERRM);
  END;

  -- Payment arrives (what the webhook does).
  UPDATE reissue_requests SET payment_status = 'PAID', paid_at = now() WHERE id = v_req;

  -- 10. ATOMICITY: force a failure at the LAST statement of fulfil (its audit
  --     insert). Every earlier step (both tag updates, custody row, proof, the
  --     reset's own audit row, the request stamp) must roll back.
  EXECUTE $f$
    CREATE FUNCTION pg_temp.ph2_fail_last() RETURNS trigger LANGUAGE plpgsql AS $t$
    BEGIN
      IF NEW.action = 'reissue_fulfil' THEN RAISE EXCEPTION 'forced_last_statement_failure'; END IF;
      RETURN NEW;
    END $t$
  $f$;
  EXECUTE 'CREATE TRIGGER ph2_fail_last BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.ph2_fail_last()';
  BEGIN
    PERFORM admin_fulfil_reissue(v_req, v_new, v_admin, v_reason, v_custody, v_oid, 'tagref', 'saltenc');
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  EXECUTE 'DROP TRIGGER ph2_fail_last ON audit_logs';
  SELECT
    (SELECT lifecycle_status = 'ACTIVE' AND current_owner_id = v_owner FROM nfc_tags WHERE id = v_old)
    AND (SELECT lifecycle_status = 'ENROLLED' AND current_owner_id IS NULL FROM nfc_tags WHERE id = v_new)
    AND (SELECT fulfilled_at IS NULL FROM reissue_requests WHERE id = v_req)
    AND NOT EXISTS (SELECT 1 FROM ownership_proofs WHERE tag_id = v_new)
    AND NOT EXISTS (SELECT 1 FROM ownership_transfers WHERE id = v_custody)
    AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE entity_id = v_old AND action = 'tag_reset')
  INTO v_ok;
  v_res := v_res || jsonb_build_object('10_atomic_last_statement',
    CASE WHEN v_err LIKE 'forced_last_statement_failure%' AND v_ok THEN 'ok' ELSE 'FAIL: err=' || v_err || ' clean=' || coalesce(v_ok::text, 'null') END);

  -- 11. Fulfil for real.
  PERFORM admin_fulfil_reissue(v_req, v_new, v_admin, v_reason, v_custody, v_oid, 'tagref', 'saltenc');
  SELECT
    (SELECT lifecycle_status = 'RETIRED' AND current_owner_id IS NULL AND destruction_status = 'PENDING' AND replaced_by_tag_id = v_new FROM nfc_tags WHERE id = v_old)
    AND (SELECT lifecycle_status = 'ACTIVE' AND current_owner_id = v_owner FROM nfc_tags WHERE id = v_new)
    AND (SELECT fulfilled_at IS NOT NULL AND fulfilled_by = v_admin AND new_tag_id = v_new FROM reissue_requests WHERE id = v_req)
    AND (SELECT count(*) = 1 FROM ownership_proofs WHERE tag_id = v_new AND status = 'current' AND owner_id = v_owner)
    AND (SELECT transfer_type = 'REISSUE' AND status = 'COMPLETED' FROM ownership_transfers WHERE id = v_custody)
    AND (SELECT count(*) = 1 FROM audit_logs WHERE entity_id = v_old AND action = 'tag_reset')
    AND (SELECT count(*) = 1 FROM audit_logs WHERE entity_id = v_req AND action = 'reissue_fulfil')
  INTO v_ok;
  v_res := v_res || jsonb_build_object('11_fulfil', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 12. A second fulfil is refused.
  BEGIN
    PERFORM admin_fulfil_reissue(v_req, v_spare, v_admin, v_reason, gen_random_uuid(), '0x' || encode(gen_random_bytes(32), 'hex'), 'tagref', 'saltenc');
    v_res := v_res || jsonb_build_object('12_no_second_fulfil', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('12_no_second_fulfil', CASE WHEN SQLERRM LIKE 'already_fulfilled%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- 13. Reject: nothing to pay.
  INSERT INTO reissue_requests (id, tag_id, requester_id, status) VALUES (v_req2, v_spare, v_owner, 'PENDING');
  PERFORM admin_review_reissue(v_req2, v_admin, false, false, v_reason);
  SELECT status, payment_status INTO v_row FROM reissue_requests WHERE id = v_req2;
  v_res := v_res || jsonb_build_object('13_reject', CASE WHEN v_row.status = 'REJECTED' AND v_row.payment_status IS NULL THEN 'ok' ELSE 'FAIL' END);

  -- 14. Approve with the fee waived: WAIVED + waive reason + its own audit action.
  INSERT INTO reissue_requests (id, tag_id, requester_id, status) VALUES (v_req3, v_spare, v_owner, 'PENDING');
  PERFORM admin_review_reissue(v_req3, v_admin, true, true, v_reason);
  SELECT status, payment_status, waive_reason INTO v_row FROM reissue_requests WHERE id = v_req3;
  SELECT count(*) INTO v_n FROM audit_logs WHERE entity_id = v_req3 AND action = 'reissue_approve_waived';
  v_res := v_res || jsonb_build_object('14_waive',
    CASE WHEN v_row.status = 'APPROVED' AND v_row.payment_status = 'WAIVED' AND v_row.waive_reason = v_reason AND v_n = 1 THEN 'ok' ELSE 'FAIL' END);

  -- 15. Waive without approve is refused.
  BEGIN
    PERFORM admin_review_reissue(v_req3, v_admin, false, true, v_reason);
    v_res := v_res || jsonb_build_object('15_waive_requires_approve', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('15_waive_requires_approve', CASE WHEN SQLERRM LIKE 'waive_requires_approve%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- 16. Grants: only service_role may execute.
  v_res := v_res || jsonb_build_object('16_grants', CASE WHEN
      NOT has_function_privilege('anon', 'admin_review_reissue(uuid,uuid,boolean,boolean,text)', 'execute')
      AND NOT has_function_privilege('authenticated', 'admin_review_reissue(uuid,uuid,boolean,boolean,text)', 'execute')
      AND NOT has_function_privilege('anon', 'admin_fulfil_reissue(uuid,uuid,uuid,text,uuid,text,text,text)', 'execute')
      AND NOT has_function_privilege('authenticated', 'admin_fulfil_reissue(uuid,uuid,uuid,text,uuid,text,text,text)', 'execute')
      AND has_function_privilege('service_role', 'admin_fulfil_reissue(uuid,uuid,uuid,text,uuid,text,text,text)', 'execute')
    THEN 'ok' ELSE 'FAIL' END);

  -- 17. Audit rows are append-only (Ph1 trigger still guards the new actions).
  BEGIN
    UPDATE audit_logs SET reason = 'tampered' WHERE entity_id = v_req;
    v_res := v_res || jsonb_build_object('17_audit_append_only', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('17_audit_append_only', CASE WHEN SQLERRM LIKE '%append-only%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- Roll EVERYTHING back, carrying the results out in the error message.
  RAISE EXCEPTION 'RESULTS %', v_res;
END;
$$;
