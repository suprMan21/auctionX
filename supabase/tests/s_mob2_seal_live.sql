-- S-MOB2 Ph A — live checks of the counter ledger, seal baseline, seal sessions and commit_seal on staging.
--
-- Leaves NOTHING behind: one DO block that ends by raising an exception carrying the results.
--
-- Dry run (before db push): BEGIN; the migration; this file; ROLLBACK;
--   { echo 'BEGIN;'; cat supabase/migrations/20261029000002_s_mob2_seal_commit.sql supabase/tests/s_mob2_seal_live.sql; echo 'ROLLBACK;'; } > <scratch>/x.sql
--   supabase db query --linked -f <scratch>/x.sql
-- After push:  supabase db query --linked -f supabase/tests/s_mob2_seal_live.sql
-- Expect: ERROR  P0001: RESULTS {...} with every check "ok".

DO $$
DECLARE
  v_admin   CONSTANT UUID := '2b3f1532-9345-4720-8fac-55d07517c78b';  -- super_admin (seller_id on test rows)
  v_creator CONSTANT UUID := '0b211aed-3cf9-4729-818d-f0ed88dd68b8';  -- test@ (Creator)
  v_other   CONSTANT UUID := '885d30e1-4322-49a8-8363-b7926991c58d';  -- test2@
  v_sha     CONSTANT TEXT := encode(extensions.gen_random_bytes(32), 'hex');
  v_tag     UUID := gen_random_uuid();
  v_tag2    UUID := gen_random_uuid();
  v_tag3    UUID := gen_random_uuid();
  v_tag4    UUID := gen_random_uuid();
  v_serial2 TEXT := upper(encode(extensions.gen_random_bytes(8), 'hex'));
  v_sess    UUID;
  v_res     JSONB := '{}'::jsonb;
  v_out     JSONB;
  v_n       INT;
  r         RECORD;
BEGIN
  -- 1. Backfill: every existing chip has a baseline.
  SELECT count(*) INTO v_n FROM nfc_tags WHERE seal_baseline_counter IS NULL;
  v_res := v_res || jsonb_build_object('01_baseline_backfilled', CASE WHEN v_n = 0 THEN 'ok' ELSE 'FAIL: ' || v_n END);

  -- 2. A new chip's baseline is its counter at insert.
  INSERT INTO nfc_tags (id, tag_uid, chip_serial, sdm_key_version, seller_id, lifecycle_status, status, sun_counter)
  VALUES (v_tag, 'FFAD0000MOB201', upper(encode(extensions.gen_random_bytes(8), 'hex')), 2, v_admin, 'ENROLLED', 'registered', 5);
  SELECT seal_baseline_counter INTO v_n FROM nfc_tags WHERE id = v_tag;
  v_res := v_res || jsonb_build_object('02_baseline_at_insert', CASE WHEN v_n = 5 THEN 'ok' ELSE 'FAIL: ' || coalesce(v_n::text, 'null') END);

  -- 3. Baseline is write-once.
  BEGIN
    UPDATE nfc_tags SET seal_baseline_counter = 7 WHERE id = v_tag;
    v_res := v_res || jsonb_build_object('03_baseline_write_once', 'FAIL: no error');
  EXCEPTION WHEN check_violation THEN
    v_res := v_res || jsonb_build_object('03_baseline_write_once', 'ok');
  END;

  -- 4. A public tap (counter burn) is recorded in the ledger.
  UPDATE nfc_tags SET sun_counter = 9 WHERE id = v_tag AND sun_counter < 9;
  SELECT count(*) INTO v_n FROM nfc_counter_ledger WHERE tag_id = v_tag AND counter = 9 AND source = 'tap';
  v_res := v_res || jsonb_build_object('04_tap_recorded', CASE WHEN v_n = 1 THEN 'ok' ELSE 'FAIL: ' || v_n END);

  -- 5. A seal tap at or below the baseline is refused.
  v_out := commit_seal(v_tag, v_creator, 5, 6, now(), now(), v_sha, NULL, false);
  v_res := v_res || jsonb_build_object('05_below_baseline', CASE WHEN v_out->>'status' = 'below_baseline' THEN 'ok' ELSE 'FAIL: ' || v_out::text END);

  -- 6. A gap between the two taps voids the take (D2).
  v_out := commit_seal(v_tag, v_creator, 6, 8, now(), now(), v_sha, NULL, false);
  v_res := v_res || jsonb_build_object('06_gap_refused', CASE WHEN v_out->>'status' = 'gap' THEN 'ok' ELSE 'FAIL: ' || v_out::text END);

  -- 7. A counter the server already accepted is refused.
  v_out := commit_seal(v_tag, v_creator, 8, 9, now(), now(), v_sha, NULL, false);
  v_res := v_res || jsonb_build_object('07_spent_refused', CASE WHEN v_out->>'status' = 'counter_spent' THEN 'ok' ELSE 'FAIL: ' || v_out::text END);

  -- 8. Delayed seal taps (both below the current counter, never seen) are accepted.
  v_out := commit_seal(v_tag, v_creator, 6, 7, now() - interval '3 minutes', now() - interval '1 minute', v_sha, NULL, false);
  SELECT lifecycle_status, current_owner_id, sun_counter, status INTO r FROM nfc_tags WHERE id = v_tag;
  SELECT count(*) INTO v_n FROM nfc_counter_ledger WHERE tag_id = v_tag AND counter IN (6, 7) AND source = 'seal';
  v_res := v_res || jsonb_build_object('08_delayed_seal_ok', CASE
    WHEN v_out->>'status' = 'ok' AND r.lifecycle_status = 'ACTIVE' AND r.current_owner_id = v_creator
         AND r.sun_counter = 9 AND r.status = 'active' AND v_n = 2 THEN 'ok'
    ELSE 'FAIL: ' || v_out::text || ' ' || row_to_json(r)::text || ' ledger=' || v_n END);

  -- 9. A sealed chip cannot be sealed again.
  v_out := commit_seal(v_tag, v_creator, 10, 11, now(), now(), v_sha, NULL, false);
  v_res := v_res || jsonb_build_object('09_no_second_seal', CASE WHEN v_out->>'status' = 'already_claimed' THEN 'ok' ELSE 'FAIL: ' || v_out::text END);

  -- 10. Public taps after the seal stay strict: the counter only rises, and each new value is recorded.
  UPDATE nfc_tags SET sun_counter = 8 WHERE id = v_tag AND sun_counter < 8;   -- the burn guard matches no row
  UPDATE nfc_tags SET sun_counter = 10 WHERE id = v_tag AND sun_counter < 10;
  SELECT sun_counter INTO v_n FROM nfc_tags WHERE id = v_tag;
  v_res := v_res || jsonb_build_object('10_public_still_strict', CASE
    WHEN v_n = 10 AND EXISTS (SELECT 1 FROM nfc_counter_ledger WHERE tag_id = v_tag AND counter = 10 AND source = 'tap')
    THEN 'ok' ELSE 'FAIL: ' || v_n END);

  -- 11. Sessions: bound to the creator and the chip, single use; the seal keeps the server time.
  INSERT INTO nfc_tags (id, tag_uid, chip_serial, sdm_key_version, seller_id, lifecycle_status, status, sun_counter)
  VALUES (v_tag2, 'FFAD0000MOB202', v_serial2, 2, v_admin, 'ENROLLED', 'registered', 0);
  INSERT INTO seal_sessions (creator_id, chip_serial) VALUES (v_creator, v_serial2) RETURNING id INTO v_sess;
  v_out := commit_seal(v_tag2, v_other, 1, 2, now(), now(), v_sha, v_sess, false);
  v_res := v_res || jsonb_build_object('11a_session_other_creator', CASE WHEN v_out->>'status' = 'session_invalid' THEN 'ok' ELSE 'FAIL: ' || v_out::text END);
  v_out := commit_seal(v_tag2, v_creator, 1, 2, now(), now(), v_sha, v_sess, true);
  SELECT count(*) INTO v_n FROM nfc_seals s JOIN seal_sessions ss ON ss.id = s.session_id
   WHERE s.tag_id = v_tag2 AND s.server_started_at = ss.started_at AND ss.used_at IS NOT NULL AND s.applied_before_recording;
  v_res := v_res || jsonb_build_object('11b_session_ok', CASE WHEN v_out->>'status' = 'ok' AND v_n = 1 THEN 'ok' ELSE 'FAIL: ' || v_out::text || ' n=' || v_n END);

  INSERT INTO nfc_tags (id, tag_uid, chip_serial, sdm_key_version, seller_id, lifecycle_status, status, sun_counter)
  VALUES (v_tag3, 'FFAD0000MOB203', upper(encode(extensions.gen_random_bytes(8), 'hex')), 2, v_admin, 'ENROLLED', 'registered', 0);
  v_out := commit_seal(v_tag3, v_creator, 1, 2, now(), now(), v_sha, v_sess, false);
  v_res := v_res || jsonb_build_object('11c_session_single_use', CASE WHEN v_out->>'status' = 'session_invalid' THEN 'ok' ELSE 'FAIL: ' || v_out::text END);

  -- 12. Not sealable: suspended chip, v1 chip (no serial).
  UPDATE nfc_tags SET suspended_at = now() WHERE id = v_tag3;
  v_out := commit_seal(v_tag3, v_creator, 1, 2, now(), now(), v_sha, NULL, false);
  INSERT INTO nfc_tags (id, tag_uid, chip_serial, sdm_key_version, seller_id, lifecycle_status, status, sun_counter)
  VALUES (v_tag4, 'FFAD0000MOB204', NULL, 1, v_admin, 'ENROLLED', 'registered', 0);
  v_res := v_res || jsonb_build_object('12_not_sealable', CASE
    WHEN v_out->>'status' = 'not_sealable'
         AND commit_seal(v_tag4, v_creator, 1, 2, now(), now(), v_sha, NULL, false)->>'status' = 'not_sealable'
    THEN 'ok' ELSE 'FAIL: ' || v_out::text END);

  -- 13. A malformed video hash is refused (and nothing changes).
  UPDATE nfc_tags SET suspended_at = NULL WHERE id = v_tag3;
  BEGIN
    v_out := commit_seal(v_tag3, v_creator, 1, 2, now(), now(), 'NOT-A-HASH', NULL, false);
    v_res := v_res || jsonb_build_object('13_bad_hash', 'FAIL: ' || v_out::text);
  EXCEPTION WHEN check_violation THEN
    v_res := v_res || jsonb_build_object('13_bad_hash', CASE
      WHEN (SELECT lifecycle_status FROM nfc_tags WHERE id = v_tag3) = 'ENROLLED' THEN 'ok' ELSE 'FAIL: tag changed' END);
  END;

  -- 14. Nothing is reachable with the publishable key.
  v_res := v_res || jsonb_build_object('14_no_anon_access', CASE
    WHEN NOT has_function_privilege('anon', 'public.commit_seal(uuid,uuid,integer,integer,timestamptz,timestamptz,text,uuid,boolean)', 'EXECUTE')
     AND NOT has_function_privilege('authenticated', 'public.commit_seal(uuid,uuid,integer,integer,timestamptz,timestamptz,text,uuid,boolean)', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'public.nfc_tags_record_counter()', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'public.nfc_tags_seal_baseline()', 'EXECUTE')
     AND NOT has_table_privilege('anon', 'public.nfc_counter_ledger', 'SELECT')
     AND NOT has_table_privilege('authenticated', 'public.nfc_counter_ledger', 'SELECT')
     AND NOT has_table_privilege('anon', 'public.nfc_seals', 'SELECT')
     AND NOT has_table_privilege('authenticated', 'public.nfc_seals', 'SELECT')
     AND NOT has_table_privilege('anon', 'public.seal_sessions', 'SELECT')
     AND NOT has_table_privilege('authenticated', 'public.seal_sessions', 'SELECT')
    THEN 'ok' ELSE 'FAIL' END);

  -- 15. RLS on for the three new tables.
  SELECT count(*) INTO v_n FROM pg_class
   WHERE oid IN ('public.nfc_counter_ledger'::regclass, 'public.nfc_seals'::regclass, 'public.seal_sessions'::regclass)
     AND relrowsecurity;
  v_res := v_res || jsonb_build_object('15_rls_on', CASE WHEN v_n = 3 THEN 'ok' ELSE 'FAIL: ' || v_n END);

  -- 16. 'seal' is an allowed step-up action.
  v_res := v_res || jsonb_build_object('16_seal_step_up_action', CASE
    WHEN pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'step_up_grants_action_chk')) LIKE '%''seal''%'
    THEN 'ok' ELSE 'FAIL' END);

  RAISE EXCEPTION 'RESULTS %', v_res;
END $$;
