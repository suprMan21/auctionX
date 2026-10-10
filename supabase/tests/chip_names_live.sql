-- Encoder auto-naming — live checks of reserve_chip_name / nfc_chip_names on staging.
--
-- Leaves NOTHING behind: the whole run is one DO block that ends by raising an
-- exception carrying the results, so every reservation and seed row rolls back.
--
-- Run: supabase db query --linked -f supabase/tests/chip_names_live.sql
-- Expect: ERROR  P0001: RESULTS {...} with every check "ok".

DO $$
DECLARE
  v_admin  CONSTANT UUID := '2b3f1532-9345-4720-8fac-55d07517c78b';  -- super_admin
  v_sig_a  CONSTANT TEXT := encode(gen_random_bytes(32), 'hex');
  v_sig_b  CONSTANT TEXT := encode(gen_random_bytes(32), 'hex');
  v_sig_c  CONSTANT TEXT := encode(gen_random_bytes(32), 'hex');
  v_tag    UUID := gen_random_uuid();
  v_res    JSONB := '{}'::jsonb;
  v_max    BIGINT;
  v_want   TEXT;
  v_next   TEXT;
  v_name   TEXT;
  v_n      INT;
BEGIN
  -- 1. Backfill: the four staging chips carry their names, bound in both tables.
  SELECT count(*) INTO v_n
    FROM nfc_tags t JOIN nfc_chip_names n ON n.tag_id = t.id AND n.name = t.chip_name
   WHERE t.chip_name IN ('chip_001', 'chip_002', 'chip_003', 'chip_004');
  v_res := v_res || jsonb_build_object('01_backfill', CASE WHEN v_n = 4 THEN 'ok' ELSE 'FAIL: ' || v_n || ' of 4' END);

  -- 2. No name -> max + 1, zero-padded to three digits.
  SELECT coalesce(max(substring(name FROM '^chip_(\d+)$')::BIGINT), 0) INTO v_max FROM nfc_chip_names WHERE name ~ '^chip_\d{1,12}$';
  v_want := 'chip_' || lpad((v_max + 1)::TEXT, 3, '0');
  v_name := reserve_chip_name(v_sig_a, NULL, v_admin);
  v_res := v_res || jsonb_build_object('02_auto_next', CASE WHEN v_name = v_want THEN 'ok' ELSE 'FAIL: got ' || v_name || ' want ' || v_want END);

  -- 3. Same chip again (a re-run) keeps its name; nothing new is reserved.
  v_next := reserve_chip_name(v_sig_a, NULL, v_admin);
  SELECT count(*) INTO v_n FROM nfc_chip_names WHERE sig_sha256 = v_sig_a;
  v_res := v_res || jsonb_build_object('03_rerun_same_name', CASE WHEN v_next = v_name AND v_n = 1 THEN 'ok' ELSE 'FAIL: ' || v_next END);

  -- 4. A second chip gets the following number.
  v_next := reserve_chip_name(v_sig_b);
  v_res := v_res || jsonb_build_object('04_second_chip_next', CASE WHEN v_next = 'chip_' || lpad((v_max + 2)::TEXT, 3, '0') THEN 'ok' ELSE 'FAIL: ' || v_next END);

  -- 5. A manual name already in use is refused, whatever its case.
  BEGIN
    PERFORM reserve_chip_name(v_sig_c, 'CHIP_004', v_admin);
    v_res := v_res || jsonb_build_object('05_taken_refused', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('05_taken_refused', CASE WHEN SQLERRM LIKE 'chip_name_taken%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- 6. A malformed name is refused.
  BEGIN
    PERFORM reserve_chip_name(v_sig_c, '../x', v_admin);
    v_res := v_res || jsonb_build_object('06_bad_name_refused', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('06_bad_name_refused', CASE WHEN SQLERRM LIKE 'chip_name_invalid%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- 7. A NULL or malformed fingerprint is refused (the NULL case must not pass).
  BEGIN
    PERFORM reserve_chip_name(NULL, NULL, v_admin);
    v_res := v_res || jsonb_build_object('07_null_sig_refused', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('07_null_sig_refused', CASE WHEN SQLERRM LIKE 'chip_name_invalid%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- 8. An un-enrolled chip re-run under a manual name swaps its reservation.
  v_next := reserve_chip_name(v_sig_b, 'live_check_rename', v_admin);
  SELECT count(*) INTO v_n FROM nfc_chip_names WHERE sig_sha256 = v_sig_b;
  v_res := v_res || jsonb_build_object('08_rename_unenrolled', CASE WHEN v_next = 'live_check_rename' AND v_n = 1 THEN 'ok' ELSE 'FAIL: ' || v_next || ' rows ' || v_n END);

  -- 9. Enroll with a name nobody reserved is refused.
  BEGIN
    INSERT INTO nfc_tags (id, tag_uid, chip_serial, originality_sig_sha256, chip_name, sdm_key_version, seller_id, lifecycle_status, status)
    VALUES (gen_random_uuid(), 'FFAD0000NAME09', upper(encode(gen_random_bytes(8), 'hex')), v_sig_c, 'live_check_unreserved', 2, v_admin, 'ENROLLED', 'registered');
    v_res := v_res || jsonb_build_object('09_unreserved_enroll_refused', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('09_unreserved_enroll_refused', CASE WHEN SQLERRM LIKE 'chip_name_not_reserved%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- 10. Enroll with a name reserved for ANOTHER chip is refused.
  BEGIN
    INSERT INTO nfc_tags (id, tag_uid, chip_serial, originality_sig_sha256, chip_name, sdm_key_version, seller_id, lifecycle_status, status)
    VALUES (gen_random_uuid(), 'FFAD0000NAME10', upper(encode(gen_random_bytes(8), 'hex')), v_sig_c, v_name, 2, v_admin, 'ENROLLED', 'registered');
    v_res := v_res || jsonb_build_object('10_other_chips_name_refused', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('10_other_chips_name_refused', CASE WHEN SQLERRM LIKE 'chip_name_not_reserved%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- 11. Enroll with the chip's own reserved name succeeds and binds the reservation.
  INSERT INTO nfc_tags (id, tag_uid, chip_serial, originality_sig_sha256, chip_name, sdm_key_version, seller_id, lifecycle_status, status)
  VALUES (v_tag, 'FFAD0000NAME11', upper(encode(gen_random_bytes(8), 'hex')), v_sig_a, v_name, 2, v_admin, 'ENROLLED', 'registered');
  SELECT count(*) INTO v_n FROM nfc_chip_names WHERE name = v_name AND tag_id = v_tag AND enrolled_at IS NOT NULL;
  v_res := v_res || jsonb_build_object('11_enroll_binds', CASE WHEN v_n = 1 THEN 'ok' ELSE 'FAIL' END);

  -- 12. An enrolled chip cannot be given another name.
  BEGIN
    PERFORM reserve_chip_name(v_sig_a, 'live_check_second_name', v_admin);
    v_res := v_res || jsonb_build_object('12_enrolled_chip_refused', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('12_enrolled_chip_refused', CASE WHEN SQLERRM LIKE 'chip_already_named%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- 13. The name on a tag row is write-once.
  BEGIN
    UPDATE nfc_tags SET chip_name = 'live_check_renamed' WHERE id = v_tag;
    v_res := v_res || jsonb_build_object('13_name_write_once', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('13_name_write_once', CASE WHEN SQLERRM LIKE 'tag_identity_immutable%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- 14. The next auto name skips everything handed out above.
  v_next := reserve_chip_name(v_sig_c);
  v_res := v_res || jsonb_build_object('14_sequence_moves_on', CASE WHEN v_next = 'chip_' || lpad((v_max + 2)::TEXT, 3, '0') THEN 'ok' ELSE 'FAIL: ' || v_next END);

  -- 15. Grants: service_role only; the table is closed to user-level keys.
  v_res := v_res || jsonb_build_object('15_grants', CASE WHEN
      NOT has_function_privilege('anon', 'reserve_chip_name(text,text,uuid)', 'execute')
      AND NOT has_function_privilege('authenticated', 'reserve_chip_name(text,text,uuid)', 'execute')
      AND has_function_privilege('service_role', 'reserve_chip_name(text,text,uuid)', 'execute')
      AND NOT has_table_privilege('anon', 'nfc_chip_names', 'select')
      AND NOT has_table_privilege('authenticated', 'nfc_chip_names', 'select')
      AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.nfc_chip_names'::regclass)
    THEN 'ok' ELSE 'FAIL' END);

  -- Roll EVERYTHING back, carrying the results out in the error message.
  RAISE EXCEPTION 'RESULTS %', v_res;
END;
$$;
