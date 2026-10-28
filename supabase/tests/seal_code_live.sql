-- S-SEAL1 Ph1 — live checks of nfc_tags.seal_code on staging.
--
-- Leaves NOTHING behind: one DO block that ends by raising an exception
-- carrying the results, so every reservation and seed row rolls back.
--
-- Dry run (before db push): BEGIN; \i the migration; this file; ROLLBACK;
--   cat supabase/migrations/20261028000003_seal_code.sql supabase/tests/seal_code_live.sql > /tmp/x.sql
--   (wrap in BEGIN … ROLLBACK) and run: supabase db query --linked -f /tmp/x.sql
-- After push:  supabase db query --linked -f supabase/tests/seal_code_live.sql
-- Expect: ERROR  P0001: RESULTS {...} with every check "ok".

DO $$
DECLARE
  v_admin  CONSTANT UUID := '2b3f1532-9345-4720-8fac-55d07517c78b';  -- super_admin
  v_sig_a  CONSTANT TEXT := encode(extensions.gen_random_bytes(32), 'hex');
  v_sig_b  CONSTANT TEXT := encode(extensions.gen_random_bytes(32), 'hex');
  v_tag    UUID := gen_random_uuid();
  v_tag2   UUID := gen_random_uuid();
  v_res    JSONB := '{}'::jsonb;
  r        RECORD;
  r2       RECORD;
  v_code   TEXT;
  v_n      INT;
  v_ok     BOOLEAN;
BEGIN
  -- 1. Backfill: every tag has a code (retired ones too), including the three live chips.
  SELECT count(*) INTO v_n FROM nfc_tags WHERE seal_code IS NULL;
  v_res := v_res || jsonb_build_object('01_backfill_complete', CASE WHEN v_n = 0 THEN 'ok' ELSE 'FAIL: ' || v_n || ' without a code' END);

  SELECT count(*) INTO v_n FROM nfc_tags WHERE chip_name IN ('chip_001', 'chip_004', 'chip_') AND seal_code IS NOT NULL;
  v_res := v_res || jsonb_build_object('02_live_chips_have_codes', CASE WHEN v_n = 3 THEN 'ok' ELSE 'FAIL: ' || v_n || ' of 3' END);

  -- 3. Bound reservations carry their tag's code.
  SELECT count(*) INTO v_n FROM nfc_chip_names n JOIN nfc_tags t ON t.id = n.tag_id
   WHERE n.seal_code IS DISTINCT FROM t.seal_code;
  v_res := v_res || jsonb_build_object('03_reservations_match_tags', CASE WHEN v_n = 0 THEN 'ok' ELSE 'FAIL: ' || v_n || ' differ' END);

  -- 4. Format: 8 Crockford base32 characters, no I, L, O, U, no hyphen.
  SELECT count(*) INTO v_n FROM nfc_tags WHERE seal_code !~ '^[0-9A-HJKMNP-TV-Z]{8}$';
  v_ok := v_n = 0;
  FOR i IN 1..200 LOOP
    v_code := gen_seal_code();
    IF v_code !~ '^[0-9A-HJKMNP-TV-Z]{8}$' THEN v_ok := FALSE; END IF;
  END LOOP;
  v_res := v_res || jsonb_build_object('04_format', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 5. A malformed code is refused by the CHECK.
  BEGIN
    INSERT INTO nfc_tags (id, tag_uid, chip_serial, sdm_key_version, seller_id, lifecycle_status, status, seal_code)
    VALUES (gen_random_uuid(), 'FFAD0000SEAL05', upper(encode(extensions.gen_random_bytes(8), 'hex')), 2, v_admin, 'ENROLLED', 'registered', 'ILOU-1234');
    v_res := v_res || jsonb_build_object('05_bad_format_refused', 'FAIL: no error');
  EXCEPTION WHEN check_violation THEN
    v_res := v_res || jsonb_build_object('05_bad_format_refused', 'ok');
  END;

  -- 6. Reserve returns a name and a code; a re-run of the same chip gets both back.
  SELECT * INTO r FROM reserve_chip_identity(v_sig_a, NULL, v_admin);
  SELECT * INTO r2 FROM reserve_chip_identity(v_sig_a, NULL, v_admin);
  v_res := v_res || jsonb_build_object('06_reserve_idempotent', CASE
    WHEN r.seal_code ~ '^[0-9A-HJKMNP-TV-Z]{8}$' AND r2.name = r.name AND r2.seal_code = r.seal_code THEN 'ok'
    ELSE 'FAIL: ' || coalesce(r.name, '?') || '/' || coalesce(r.seal_code, '?') || ' then ' || coalesce(r2.seal_code, '?') END);

  -- 7. A second chip gets a different code.
  SELECT * INTO r2 FROM reserve_chip_identity(v_sig_b, NULL, v_admin);
  v_res := v_res || jsonb_build_object('07_distinct_codes', CASE WHEN r2.seal_code <> r.seal_code THEN 'ok' ELSE 'FAIL' END);

  -- 8. Enroll copies the reserved code onto the tag.
  INSERT INTO nfc_tags (id, tag_uid, chip_serial, originality_sig_sha256, chip_name, sdm_key_version, seller_id, lifecycle_status, status)
  VALUES (v_tag, 'FFAD0000SEAL08', upper(encode(extensions.gen_random_bytes(8), 'hex')), v_sig_a, r.name, 2, v_admin, 'ENROLLED', 'registered');
  SELECT seal_code INTO v_code FROM nfc_tags WHERE id = v_tag;
  v_res := v_res || jsonb_build_object('08_enroll_takes_reserved_code', CASE WHEN v_code = r.seal_code THEN 'ok' ELSE 'FAIL: ' || coalesce(v_code, 'null') END);

  -- 9. A tag enrolled without a name still gets a fresh code.
  INSERT INTO nfc_tags (id, tag_uid, chip_serial, sdm_key_version, seller_id, lifecycle_status, status)
  VALUES (v_tag2, 'FFAD0000SEAL09', upper(encode(extensions.gen_random_bytes(8), 'hex')), 2, v_admin, 'ENROLLED', 'registered');
  SELECT seal_code INTO v_code FROM nfc_tags WHERE id = v_tag2;
  v_res := v_res || jsonb_build_object('09_unnamed_gets_code', CASE WHEN v_code ~ '^[0-9A-HJKMNP-TV-Z]{8}$' THEN 'ok' ELSE 'FAIL' END);

  -- 10. Unique: another tag cannot take an existing code.
  BEGIN
    INSERT INTO nfc_tags (id, tag_uid, chip_serial, sdm_key_version, seller_id, lifecycle_status, status, seal_code)
    VALUES (gen_random_uuid(), 'FFAD0000SEAL10', upper(encode(extensions.gen_random_bytes(8), 'hex')), 2, v_admin, 'ENROLLED', 'registered', v_code);
    v_res := v_res || jsonb_build_object('10_unique', 'FAIL: no error');
  EXCEPTION WHEN unique_violation THEN
    v_res := v_res || jsonb_build_object('10_unique', 'ok');
  END;

  -- 11. Write-once: changing a code is refused.
  BEGIN
    UPDATE nfc_tags SET seal_code = gen_seal_code() WHERE id = v_tag2;
    v_res := v_res || jsonb_build_object('11_change_refused', 'FAIL: no error');
  EXCEPTION WHEN check_violation THEN
    v_res := v_res || jsonb_build_object('11_change_refused', CASE WHEN SQLERRM LIKE 'tag_identity_immutable%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- 12. Write-once: clearing a code is refused.
  BEGIN
    UPDATE nfc_tags SET seal_code = NULL WHERE id = v_tag2;
    v_res := v_res || jsonb_build_object('12_clear_refused', 'FAIL: no error');
  EXCEPTION WHEN check_violation THEN
    v_res := v_res || jsonb_build_object('12_clear_refused', CASE WHEN SQLERRM LIKE 'tag_identity_immutable%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- 13. A reservation's code is write-once too.
  BEGIN
    UPDATE nfc_chip_names SET seal_code = gen_seal_code() WHERE sig_sha256 = v_sig_b;
    v_res := v_res || jsonb_build_object('13_reservation_code_fixed', 'FAIL: no error');
  EXCEPTION WHEN check_violation THEN
    v_res := v_res || jsonb_build_object('13_reservation_code_fixed', 'ok');
  END;

  -- 14. Other lifecycle updates still work (write-once only blocks the code).
  UPDATE nfc_tags SET lifecycle_status = 'SUSPENDED' WHERE id = v_tag2;
  v_res := v_res || jsonb_build_object('14_other_updates_ok', 'ok');

  -- 15. Functions: service_role only.
  v_res := v_res || jsonb_build_object('15_function_grants', CASE WHEN
      NOT has_function_privilege('anon', 'reserve_chip_identity(text,text,uuid)', 'execute')
      AND NOT has_function_privilege('authenticated', 'reserve_chip_identity(text,text,uuid)', 'execute')
      AND has_function_privilege('service_role', 'reserve_chip_identity(text,text,uuid)', 'execute')
      AND NOT has_function_privilege('anon', 'gen_seal_code()', 'execute')
      AND NOT has_function_privilege('authenticated', 'gen_seal_code()', 'execute')
      AND NOT has_function_privilege('anon', 'new_unused_seal_code()', 'execute')
      AND NOT has_function_privilege('authenticated', 'new_unused_seal_code()', 'execute')
    THEN 'ok' ELSE 'FAIL' END);

  -- 16. anon reads no tag row, so no seal code (RLS: owner read only).
  PERFORM set_config('role', 'anon', true);
  SELECT count(*) INTO v_n FROM nfc_tags WHERE seal_code IS NOT NULL;
  PERFORM set_config('role', 'postgres', true);
  v_res := v_res || jsonb_build_object('16_anon_reads_nothing', CASE WHEN v_n = 0 THEN 'ok' ELSE 'FAIL: ' || v_n || ' rows' END);

  -- Roll EVERYTHING back, carrying the results out in the error message.
  RAISE EXCEPTION 'RESULTS %', v_res;
END;
$$;
