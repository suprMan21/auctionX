-- S-ADMIN1 Ph3a — live checks of the stuck-payment functions on staging
-- (20261011000001_s_admin1_stuck_payments.sql).
--
-- Leaves NOTHING behind: the whole run is one DO block that ends by raising an
-- exception carrying the results, so every seed row, audit row, incident and
-- the temporary failure trigger roll back.
--
-- Run: supabase db query --linked -f supabase/tests/s_admin1_ph3a_live.sql
-- Expect: ERROR  P0001: RESULTS {...} with every check "ok".

DO $$
DECLARE
  v_owner    CONSTANT UUID := '0b211aed-3cf9-4729-818d-f0ed88dd68b8';  -- test@
  v_buyer    CONSTANT UUID := '885d30e1-4322-49a8-8363-b7926991c58d';  -- test2@ (not an admin)
  v_admin    CONSTANT UUID := '2b3f1532-9345-4720-8fac-55d07517c78b';  -- super_admin
  v_reason   CONSTANT TEXT := 'Live check S-ADMIN1 Ph3a, rolled back';
  v_tag      UUID := gen_random_uuid();
  v_tag2     UUID := gen_random_uuid();
  v_tag3     UUID := gen_random_uuid();
  v_t1       UUID := gen_random_uuid();   -- applied by the webhook path
  v_t2       UUID := gen_random_uuid();   -- no recipient, then re-applied
  v_t3       UUID := gen_random_uuid();   -- refunded while pending
  v_req      UUID := gen_random_uuid();
  v_req2     UUID := gen_random_uuid();
  v_inc      UUID;
  v_inc2     UUID;
  v_inc3     UUID;
  v_support_role UUID;
  v_res      JSONB := '{}'::jsonb;
  v_out      JSONB;
  v_row      RECORD;
  v_n        INT;
  v_ok       BOOLEAN;
  v_oid      TEXT;
BEGIN
  -- ── Seed ─────────────────────────────────────────────────────────────────
  INSERT INTO nfc_tags (id, tag_uid, chip_serial, sdm_key_version, seller_id, lifecycle_status, current_owner_id, status, metadata)
  VALUES
    (v_tag,  'FFAD0000PH3A001', upper(encode(gen_random_bytes(8), 'hex')), 2, v_admin, 'ACTIVE',    v_owner, 'active', '{"test":"s-admin1-ph3a"}'),
    (v_tag2, 'FFAD0000PH3A002', upper(encode(gen_random_bytes(8), 'hex')), 2, v_admin, 'SUSPENDED', v_owner, 'active', '{"test":"s-admin1-ph3a"}'),
    (v_tag3, 'FFAD0000PH3A003', upper(encode(gen_random_bytes(8), 'hex')), 2, v_admin, 'ACTIVE',    v_owner, 'active', '{"test":"s-admin1-ph3a"}');

  INSERT INTO ownership_proofs (tag_id, ownership_event_id, ownership_event_type, ownership_id, tag_ref, salt_enc, owner_id, status)
  VALUES (v_tag, gen_random_uuid(), 'claim', '0x' || encode(gen_random_bytes(32), 'hex'), 'tagref', 'saltenc', v_owner, 'current');

  INSERT INTO ownership_transfers (id, tag_id, from_user_id, to_user_id, to_email, transfer_type, status, stripe_payment_intent_id, initiated_at)
  VALUES
    (v_t1, v_tag,  v_owner, v_buyer, NULL,                  'SALE', 'PENDING', 'pi_ph3a_live_1', now()),
    (v_t2, v_tag2, v_owner, NULL,    'nobody@example.test', 'SALE', 'PENDING', 'pi_ph3a_live_2', now()),
    (v_t3, v_tag3, v_owner, v_buyer, NULL,                  'SALE', 'PENDING', 'pi_ph3a_live_3', now());

  -- A support admin (test2@), for the role checks. Rolled back with the rest.
  SELECT role_id INTO v_support_role FROM admin_roles WHERE role_name = 'support';
  INSERT INTO admin_users (admin_id, role_id, brand, is_active) VALUES (v_buyer, v_support_role, 'auctionx', true);

  -- ── apply_transfer_fee ───────────────────────────────────────────────────

  -- 1. A foreign intent cannot complete the transfer.
  v_out := apply_transfer_fee(v_t1, 'pi_someone_else', '0x' || encode(gen_random_bytes(32), 'hex'), 'tagref', 'saltenc', 'webhook');
  SELECT status = 'PENDING' INTO v_ok FROM ownership_transfers WHERE id = v_t1;
  v_res := v_res || jsonb_build_object('01_intent_mismatch',
    CASE WHEN v_out->>'outcome' = 'intent_mismatch' AND v_ok THEN 'ok' ELSE 'FAIL: ' || v_out::text END);

  -- 2. An unknown source is refused.
  BEGIN
    PERFORM apply_transfer_fee(v_t1, 'pi_ph3a_live_1', '0x' || encode(gen_random_bytes(32), 'hex'), 'tagref', 'saltenc', 'client');
    v_res := v_res || jsonb_build_object('02_source_closed_set', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('02_source_closed_set', CASE WHEN SQLERRM LIKE 'invalid_source%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- 3. ATOMICITY: force a failure at the LAST write of the apply (the new
  --    proof). The transfer and the tag must not have moved.
  CREATE OR REPLACE FUNCTION pg_temp.ph3a_fail_proof() RETURNS trigger LANGUAGE plpgsql AS $f$
  BEGIN
    IF NEW.tag_ref = 'ph3a-force-fail' THEN RAISE EXCEPTION 'ph3a_forced_failure'; END IF;
    RETURN NEW;
  END $f$;
  CREATE TRIGGER ph3a_fail_proof BEFORE INSERT ON ownership_proofs
    FOR EACH ROW EXECUTE FUNCTION pg_temp.ph3a_fail_proof();
  BEGIN
    PERFORM apply_transfer_fee(v_t1, 'pi_ph3a_live_1', '0x' || encode(gen_random_bytes(32), 'hex'), 'ph3a-force-fail', 'saltenc', 'webhook');
    v_res := v_res || jsonb_build_object('03_atomic_rollback', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    SELECT (SELECT status FROM ownership_transfers WHERE id = v_t1) = 'PENDING'
       AND (SELECT current_owner_id FROM nfc_tags WHERE id = v_tag) = v_owner
       AND (SELECT count(*) FROM ownership_proofs WHERE tag_id = v_tag AND status = 'current') = 1
      INTO v_ok;
    v_res := v_res || jsonb_build_object('03_atomic_rollback',
      CASE WHEN SQLERRM LIKE 'ph3a_forced_failure%' AND v_ok THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;
  DROP TRIGGER ph3a_fail_proof ON ownership_proofs;

  -- 4. The real apply: transfer COMPLETED, owner moved, proof rotated.
  v_oid := '0x' || encode(gen_random_bytes(32), 'hex');
  v_out := apply_transfer_fee(v_t1, 'pi_ph3a_live_1', v_oid, 'tagref', 'saltenc', 'webhook');
  SELECT t.status, t.transfer_fee_paid, t.completed_at IS NOT NULL AS done, g.current_owner_id, g.lifecycle_status::text AS life
    INTO v_row FROM ownership_transfers t JOIN nfc_tags g ON g.id = t.tag_id WHERE t.id = v_t1;
  SELECT count(*) INTO v_n FROM ownership_proofs
   WHERE tag_id = v_tag AND status = 'current' AND ownership_id = v_oid AND owner_id = v_buyer AND ownership_event_id = v_t1;
  v_res := v_res || jsonb_build_object('04_apply',
    CASE WHEN v_out->>'outcome' = 'applied' AND v_row.status = 'COMPLETED' AND v_row.transfer_fee_paid AND v_row.done
              AND v_row.current_owner_id = v_buyer AND v_row.life = 'ACTIVE' AND v_n = 1
              AND (SELECT count(*) FROM ownership_proofs WHERE tag_id = v_tag AND status = 'current') = 1
         THEN 'ok' ELSE 'FAIL: ' || v_out::text || ' ' || row_to_json(v_row)::text || ' proofs=' || v_n END);

  -- 5. A replay changes nothing and mints nothing.
  v_out := apply_transfer_fee(v_t1, 'pi_ph3a_live_1', '0x' || encode(gen_random_bytes(32), 'hex'), 'tagref', 'saltenc', 'webhook');
  SELECT count(*) INTO v_n FROM ownership_proofs WHERE tag_id = v_tag;
  v_res := v_res || jsonb_build_object('05_replay',
    CASE WHEN v_out->>'outcome' = 'already_completed' AND v_n = 2 THEN 'ok' ELSE 'FAIL: ' || v_out::text || ' proofs=' || v_n END);

  -- 6. No recipient: nothing moves, and it is an outcome, not an exception.
  v_out := apply_transfer_fee(v_t2, 'pi_ph3a_live_2', '0x' || encode(gen_random_bytes(32), 'hex'), 'tagref', 'saltenc', 'webhook');
  SELECT status = 'PENDING' INTO v_ok FROM ownership_transfers WHERE id = v_t2;
  v_res := v_res || jsonb_build_object('06_no_recipient',
    CASE WHEN v_out->>'outcome' = 'no_recipient' AND v_ok THEN 'ok' ELSE 'FAIL: ' || v_out::text END);

  -- ── record_payment_incident ──────────────────────────────────────────────

  -- 7. First sighting opens one incident; a repeat bumps it, never duplicates.
  v_out := record_payment_incident('transfer_fee', 'pi_ph3a_live_2', v_t2, NULL, 'no_recipient', 250, 'usd', NULL);
  v_inc := (v_out->>'id')::uuid;
  v_ok  := (v_out->>'is_new')::boolean AND v_out->>'status' = 'OPEN';
  v_out := record_payment_incident('transfer_fee', 'pi_ph3a_live_2', v_t2, NULL, 'apply_failed', 250, 'usd', 'apply_rpc_failed');
  SELECT count(*) INTO v_n FROM payment_incidents WHERE stripe_payment_intent_id = 'pi_ph3a_live_2';
  v_res := v_res || jsonb_build_object('07_incident_dedup',
    CASE WHEN v_ok AND NOT (v_out->>'is_new')::boolean AND (v_out->>'id')::uuid = v_inc
              AND (v_out->>'seen_count')::int = 2 AND v_out->>'reason' = 'apply_failed' AND v_n = 1
         THEN 'ok' ELSE 'FAIL: ' || v_out::text END);

  -- 8. An id that names no row is dropped instead of breaking the foreign key.
  v_out := record_payment_incident('transfer_fee', 'pi_ph3a_live_ghost', gen_random_uuid(), NULL, 'row_missing', 250, 'usd', NULL);
  v_res := v_res || jsonb_build_object('08_ghost_row',
    CASE WHEN v_out->>'transfer_id' IS NULL AND v_out->>'status' = 'OPEN' THEN 'ok' ELSE 'FAIL: ' || v_out::text END);

  -- 9. Born closed (the sweep already applied it): RESOLVED with a resolution.
  v_out := record_payment_incident('transfer_fee', 'pi_ph3a_live_1', v_t1, NULL, 'webhook_missed', 250, 'usd', NULL, 'sweep');
  v_res := v_res || jsonb_build_object('09_born_closed',
    CASE WHEN v_out->>'status' = 'RESOLVED' AND v_out->>'resolution' = 'sweep' AND v_out->>'resolved_at' IS NOT NULL
         THEN 'ok' ELSE 'FAIL: ' || v_out::text END);

  -- 10. The table refuses a closed incident with no resolution (NULL included).
  BEGIN
    UPDATE payment_incidents SET status = 'RESOLVED', resolution = NULL, resolved_at = now() WHERE id = v_inc;
    RAISE EXCEPTION 'accepted_but_must_be_refused';
  EXCEPTION WHEN check_violation THEN
    v_res := v_res || jsonb_build_object('10_check_closed_needs_resolution', 'ok');
  WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('10_check_closed_needs_resolution', 'FAIL: ' || SQLERRM);
  END;

  -- 10b. ...and a REFUNDED one with no refund id.
  BEGIN
    UPDATE payment_incidents SET status = 'REFUNDED', resolution = 'refund', resolved_at = now(), stripe_refund_id = NULL WHERE id = v_inc;
    RAISE EXCEPTION 'accepted_but_must_be_refused';
  EXCEPTION WHEN check_violation THEN
    v_res := v_res || jsonb_build_object('10b_check_refund_needs_id', 'ok');
  WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('10b_check_refund_needs_id', 'FAIL: ' || SQLERRM);
  END;

  -- ── admin_reapply_payment ────────────────────────────────────────────────

  -- 11. A non-admin is refused by the function itself.
  BEGIN
    PERFORM admin_reapply_payment(v_inc, v_owner, v_reason, '0x' || encode(gen_random_bytes(32), 'hex'), 'tagref', 'saltenc');
    v_res := v_res || jsonb_build_object('11_non_admin_refused', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('11_non_admin_refused',
      CASE WHEN SQLSTATE = '42501' AND SQLERRM LIKE 'admin_forbidden%' THEN 'ok' ELSE 'FAIL: ' || SQLSTATE || ' ' || SQLERRM END);
  END;

  -- 12. Short reason refused.
  BEGIN
    PERFORM admin_reapply_payment(v_inc, v_admin, 'short', '0x' || encode(gen_random_bytes(32), 'hex'), 'tagref', 'saltenc');
    v_res := v_res || jsonb_build_object('12_reason_required', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('12_reason_required', CASE WHEN SQLERRM LIKE 'reason_required%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- 13. Re-apply while still stuck: nothing moves, the incident stays open,
  --     and the attempt is audited with its outcome.
  v_out := admin_reapply_payment(v_inc, v_buyer, v_reason, '0x' || encode(gen_random_bytes(32), 'hex'), 'tagref', 'saltenc');
  SELECT status, last_error INTO v_row FROM payment_incidents WHERE id = v_inc;
  SELECT count(*) INTO v_n FROM audit_logs
   WHERE entity_id = v_inc AND action = 'payment_reapply' AND admin_id = v_buyer AND changes->>'outcome' = 'no_recipient';
  v_res := v_res || jsonb_build_object('13_reapply_still_stuck',
    CASE WHEN v_out->>'outcome' = 'no_recipient' AND v_row.status = 'OPEN' AND v_row.last_error = 'reapply_no_recipient' AND v_n = 1
         THEN 'ok' ELSE 'FAIL: ' || v_out::text || ' ' || row_to_json(v_row)::text || ' audit=' || v_n END);

  -- 14. The recipient resolves; SUPPORT re-applies. Ownership moves, the
  --     incident closes, and the admin suspension on the token survives.
  UPDATE ownership_transfers SET to_user_id = v_buyer WHERE id = v_t2;
  v_out := admin_reapply_payment(v_inc, v_buyer, v_reason, '0x' || encode(gen_random_bytes(32), 'hex'), 'tagref', 'saltenc');
  SELECT i.status, i.resolution, i.resolved_by, i.resolved_reason, t.status AS t_status, g.current_owner_id, g.lifecycle_status::text AS life
    INTO v_row
    FROM payment_incidents i JOIN ownership_transfers t ON t.id = i.transfer_id JOIN nfc_tags g ON g.id = t.tag_id
   WHERE i.id = v_inc;
  v_res := v_res || jsonb_build_object('14_support_reapply',
    CASE WHEN v_out->>'outcome' = 'applied' AND v_row.status = 'RESOLVED' AND v_row.resolution = 'reapply'
              AND v_row.resolved_by = v_buyer AND v_row.resolved_reason = v_reason
              AND v_row.t_status = 'COMPLETED' AND v_row.current_owner_id = v_buyer AND v_row.life = 'SUSPENDED'
         THEN 'ok' ELSE 'FAIL: ' || v_out::text || ' ' || row_to_json(v_row)::text END);

  -- 15. A second Re-apply on the closed incident is refused.
  BEGIN
    PERFORM admin_reapply_payment(v_inc, v_admin, v_reason, '0x' || encode(gen_random_bytes(32), 'hex'), 'tagref', 'saltenc');
    v_res := v_res || jsonb_build_object('15_reapply_closed_refused', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('15_reapply_closed_refused', CASE WHEN SQLERRM LIKE 'incident_not_open%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- ── admin_refund_payment_incident ────────────────────────────────────────

  v_out := record_payment_incident('transfer_fee', 'pi_ph3a_live_3', v_t3, NULL, 'apply_failed', 250, 'usd', NULL);
  v_inc2 := (v_out->>'id')::uuid;

  -- 16. Support may NOT refund (Locked 2026-10-03), though its role carries
  --     process_refunds from the parked marketplace.
  BEGIN
    PERFORM admin_refund_payment_incident(v_inc2, v_buyer, v_reason, 're_ph3a_live');
    v_res := v_res || jsonb_build_object('16_support_cannot_refund', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('16_support_cannot_refund',
      CASE WHEN SQLSTATE = '42501' AND SQLERRM LIKE 'admin_forbidden%' THEN 'ok' ELSE 'FAIL: ' || SQLSTATE || ' ' || SQLERRM END);
  END;

  -- 17. A refund must name its Stripe refund.
  BEGIN
    PERFORM admin_refund_payment_incident(v_inc2, v_admin, v_reason, '  ');
    v_res := v_res || jsonb_build_object('17_refund_id_required', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('17_refund_id_required', CASE WHEN SQLERRM LIKE 'refund_id_required%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- 18. Admin refund: incident REFUNDED, pending transfer cancelled, owner
  --     unchanged, audit row written.
  v_out := admin_refund_payment_incident(v_inc2, v_admin, v_reason, 're_ph3a_live');
  SELECT i.status, i.resolution, i.stripe_refund_id, t.status AS t_status, g.current_owner_id
    INTO v_row
    FROM payment_incidents i JOIN ownership_transfers t ON t.id = i.transfer_id JOIN nfc_tags g ON g.id = t.tag_id
   WHERE i.id = v_inc2;
  SELECT count(*) INTO v_n FROM audit_logs WHERE entity_id = v_inc2 AND action = 'payment_refund' AND admin_id = v_admin;
  v_res := v_res || jsonb_build_object('18_admin_refund',
    CASE WHEN (v_out->>'transfer_cancelled')::boolean AND v_row.status = 'REFUNDED' AND v_row.resolution = 'refund'
              AND v_row.stripe_refund_id = 're_ph3a_live' AND v_row.t_status = 'CANCELLED'
              AND v_row.current_owner_id = v_owner AND v_n = 1
         THEN 'ok' ELSE 'FAIL: ' || v_out::text || ' ' || row_to_json(v_row)::text || ' audit=' || v_n END);

  -- 19. A refunded incident is never reopened by a later sighting, and a
  --     cancelled transfer cannot be completed.
  v_out := record_payment_incident('transfer_fee', 'pi_ph3a_live_3', v_t3, NULL, 'not_payable', 250, 'usd', NULL);
  v_ok  := v_out->>'status' = 'REFUNDED' AND NOT (v_out->>'is_new')::boolean;
  v_out := apply_transfer_fee(v_t3, 'pi_ph3a_live_3', '0x' || encode(gen_random_bytes(32), 'hex'), 'tagref', 'saltenc', 'webhook');
  v_res := v_res || jsonb_build_object('19_refunded_stays_closed',
    CASE WHEN v_ok AND v_out->>'outcome' = 'not_payable' THEN 'ok' ELSE 'FAIL: ' || v_out::text END);

  -- ── apply_reissue_fee ────────────────────────────────────────────────────

  INSERT INTO reissue_requests (id, tag_id, requester_id, status, payment_status, stripe_payment_intent_id, charged_amount, charged_currency, list_amount_usd_cents, fx_rate, photo_keys)
  VALUES
    (v_req,  v_tag3, v_owner, 'APPROVED',  'AWAITING_PAYMENT', 'pi_ph3a_live_r1', 1000, 'usd', 1000, 1, ARRAY['reissue-evidence/x/a.jpg']);

  -- 20. Wrong intent refused; right intent marks PAID; replay is a no-op.
  v_out := apply_reissue_fee(v_req, 'pi_someone_else', 'webhook');
  v_ok  := v_out->>'outcome' = 'intent_mismatch';
  v_out := apply_reissue_fee(v_req, 'pi_ph3a_live_r1', 'webhook');
  v_ok  := v_ok AND v_out->>'outcome' = 'applied' AND (v_out->>'requester_id')::uuid = v_owner;
  v_out := apply_reissue_fee(v_req, 'pi_ph3a_live_r1', 'sweep');
  SELECT payment_status, paid_at IS NOT NULL AS paid, fulfilled_at INTO v_row FROM reissue_requests WHERE id = v_req;
  v_res := v_res || jsonb_build_object('20_reissue_apply',
    CASE WHEN v_ok AND v_out->>'outcome' = 'already_paid' AND v_row.payment_status = 'PAID' AND v_row.paid AND v_row.fulfilled_at IS NULL
         THEN 'ok' ELSE 'FAIL: ' || v_out::text || ' ' || row_to_json(v_row)::text END);

  -- 21. A paid fee on a cancelled request is not payable, and an admin can
  --     refund it; the request itself is left alone.
  UPDATE reissue_requests SET status = 'CANCELLED', payment_status = 'AWAITING_PAYMENT', paid_at = NULL WHERE id = v_req;
  v_out := apply_reissue_fee(v_req, 'pi_ph3a_live_r1', 'webhook');
  v_ok  := v_out->>'outcome' = 'not_payable';
  v_out := record_payment_incident('reissue_fee', 'pi_ph3a_live_r1', NULL, v_req, 'not_payable', 1000, 'usd', NULL);
  v_inc3 := (v_out->>'id')::uuid;
  v_out := admin_reapply_payment(v_inc3, v_admin, v_reason, NULL, NULL, NULL);
  v_ok  := v_ok AND v_out->>'outcome' = 'not_payable';
  v_out := admin_refund_payment_incident(v_inc3, v_admin, v_reason, 're_ph3a_live_r1');
  SELECT status, payment_status INTO v_row FROM reissue_requests WHERE id = v_req;
  v_res := v_res || jsonb_build_object('21_reissue_paid_then_void',
    CASE WHEN v_ok AND NOT (v_out->>'transfer_cancelled')::boolean AND v_row.status = 'CANCELLED' AND v_row.payment_status = 'AWAITING_PAYMENT'
         THEN 'ok' ELSE 'FAIL: ' || v_out::text || ' ' || row_to_json(v_row)::text END);

  -- ── Access ───────────────────────────────────────────────────────────────

  -- 22. Functions: service_role only.
  v_res := v_res || jsonb_build_object('22_function_grants', CASE WHEN
      NOT has_function_privilege('anon', 'apply_transfer_fee(uuid,text,text,text,text,text)', 'execute')
      AND NOT has_function_privilege('authenticated', 'apply_transfer_fee(uuid,text,text,text,text,text)', 'execute')
      AND NOT has_function_privilege('anon', 'apply_reissue_fee(uuid,text,text)', 'execute')
      AND NOT has_function_privilege('authenticated', 'apply_reissue_fee(uuid,text,text)', 'execute')
      AND NOT has_function_privilege('anon', 'record_payment_incident(text,text,uuid,uuid,text,integer,text,text,text)', 'execute')
      AND NOT has_function_privilege('authenticated', 'record_payment_incident(text,text,uuid,uuid,text,integer,text,text,text)', 'execute')
      AND NOT has_function_privilege('anon', 'admin_reapply_payment(uuid,uuid,text,text,text,text)', 'execute')
      AND NOT has_function_privilege('authenticated', 'admin_reapply_payment(uuid,uuid,text,text,text,text)', 'execute')
      AND NOT has_function_privilege('anon', 'admin_refund_payment_incident(uuid,uuid,text,text)', 'execute')
      AND NOT has_function_privilege('authenticated', 'admin_refund_payment_incident(uuid,uuid,text,text)', 'execute')
      AND NOT has_function_privilege('authenticated', 'payment_admin_actor_email(uuid,boolean)', 'execute')
      AND has_function_privilege('service_role', 'apply_transfer_fee(uuid,text,text,text,text,text)', 'execute')
      AND has_function_privilege('service_role', 'admin_refund_payment_incident(uuid,uuid,text,text)', 'execute')
    THEN 'ok' ELSE 'FAIL' END);

  -- 23. Table: no access for anon or authenticated, RLS on, no policy.
  v_res := v_res || jsonb_build_object('23_table_locked', CASE WHEN
      NOT has_table_privilege('anon', 'public.payment_incidents', 'select')
      AND NOT has_table_privilege('authenticated', 'public.payment_incidents', 'select')
      AND NOT has_table_privilege('authenticated', 'public.payment_incidents', 'insert')
      AND NOT has_table_privilege('authenticated', 'public.payment_incidents', 'update')
      AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.payment_incidents'::regclass)
      AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'payment_incidents') = 0
    THEN 'ok' ELSE 'FAIL' END);

  -- 24. The 10-minute tick is scheduled.
  SELECT count(*) INTO v_n FROM cron.job WHERE jobname = 'token-fee-sweep-tick' AND schedule = '*/10 * * * *' AND active;
  v_res := v_res || jsonb_build_object('24_sweep_tick_scheduled', CASE WHEN v_n = 1 THEN 'ok' ELSE 'FAIL: jobs=' || v_n END);

  -- 25. Audit rows for the new actions are append-only (Ph1 trigger).
  BEGIN
    UPDATE audit_logs SET reason = 'tampered' WHERE entity_id = v_inc2;
    v_res := v_res || jsonb_build_object('25_audit_append_only', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('25_audit_append_only', CASE WHEN SQLERRM LIKE '%append-only%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- Roll EVERYTHING back, carrying the results out in the error message.
  RAISE EXCEPTION 'RESULTS %', v_res;
END;
$$;
