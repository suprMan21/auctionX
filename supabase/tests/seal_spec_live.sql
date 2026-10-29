-- S-SEAL1 Ph2a — live checks of nfc_tags.seal_spec on staging.
--
-- Leaves NOTHING behind: one DO block that ends by raising an exception
-- carrying the results, so every seed row rolls back.
--
-- Dry run (before db push): BEGIN; migration; this file; ROLLBACK;
--   (printf 'BEGIN;\n'; cat supabase/migrations/20261028000004_seal_spec.sql supabase/tests/seal_spec_live.sql; printf 'ROLLBACK;\n') > /tmp/x.sql
--   supabase db query --linked -f /tmp/x.sql
-- After push:  supabase db query --linked -f supabase/tests/seal_spec_live.sql
-- Expect: ERROR  P0001: RESULTS {...} with every check "ok".

DO $$
DECLARE
  v_admin CONSTANT UUID := '2b3f1532-9345-4720-8fac-55d07517c78b';  -- super_admin
  v_tag   UUID := gen_random_uuid();
  v_old   UUID := gen_random_uuid();
  v_res   JSONB := '{}'::jsonb;
  v_code  TEXT;
  v_spec  JSONB;
  v_ok    BOOLEAN;
BEGIN
  -- 1. Columns exist and start empty for a new tag.
  INSERT INTO nfc_tags (id, tag_uid, chip_serial, sdm_key_version, seller_id, lifecycle_status, status)
  VALUES (v_tag, 'FFAD0000SPEC01', upper(encode(extensions.gen_random_bytes(8), 'hex')), 2, v_admin, 'ENROLLED', 'registered');
  SELECT seal_code, seal_spec INTO v_code, v_spec FROM nfc_tags WHERE id = v_tag;
  v_res := v_res || jsonb_build_object('01_new_tag_no_spec', CASE WHEN v_spec IS NULL AND v_code IS NOT NULL THEN 'ok' ELSE 'FAIL' END);

  -- 2. Shape: not an object, or missing v / code, is refused.
  BEGIN
    UPDATE nfc_tags SET seal_spec = '[1]'::jsonb WHERE id = v_tag;
    v_res := v_res || jsonb_build_object('02_non_object_refused', 'FAIL: no error');
  EXCEPTION WHEN check_violation THEN
    v_res := v_res || jsonb_build_object('02_non_object_refused', 'ok');
  END;
  BEGIN
    UPDATE nfc_tags SET seal_spec = jsonb_build_object('code', v_code) WHERE id = v_tag;
    v_res := v_res || jsonb_build_object('03_missing_v_refused', 'FAIL: no error');
  EXCEPTION WHEN check_violation THEN
    v_res := v_res || jsonb_build_object('03_missing_v_refused', 'ok');
  END;

  -- 4. A spec for another seal code is refused.
  BEGIN
    UPDATE nfc_tags SET seal_spec = '{"v":1,"code":"00000000"}'::jsonb WHERE id = v_tag;
    v_res := v_res || jsonb_build_object('04_wrong_code_refused', CASE WHEN v_code = '00000000' THEN 'ok (code collided)' ELSE 'FAIL: no error' END);
  EXCEPTION WHEN check_violation THEN
    v_res := v_res || jsonb_build_object('04_wrong_code_refused', 'ok');
  END;

  -- 5. The first write is allowed.
  UPDATE nfc_tags SET seal_spec = jsonb_build_object('v', 1, 'code', v_code, 'colors', 'am-default') WHERE id = v_tag;
  SELECT seal_spec INTO v_spec FROM nfc_tags WHERE id = v_tag;
  v_res := v_res || jsonb_build_object('05_first_write_ok', CASE WHEN v_spec ->> 'code' = v_code THEN 'ok' ELSE 'FAIL' END);

  -- 6. Write-once: change refused.
  BEGIN
    UPDATE nfc_tags SET seal_spec = jsonb_build_object('v', 2, 'code', v_code) WHERE id = v_tag;
    v_res := v_res || jsonb_build_object('06_change_refused', 'FAIL: no error');
  EXCEPTION WHEN check_violation THEN
    v_res := v_res || jsonb_build_object('06_change_refused', 'ok');
  END;

  -- 7. Write-once: clear refused.
  BEGIN
    UPDATE nfc_tags SET seal_spec = NULL WHERE id = v_tag;
    v_res := v_res || jsonb_build_object('07_clear_refused', 'FAIL: no error');
  EXCEPTION WHEN check_violation THEN
    v_res := v_res || jsonb_build_object('07_clear_refused', 'ok');
  END;

  -- 8. Writing the same spec again is a no-op, not an error (the backend's guarded update).
  BEGIN
    UPDATE nfc_tags SET seal_spec = v_spec WHERE id = v_tag;
    v_res := v_res || jsonb_build_object('08_same_value_ok', 'ok');
  EXCEPTION WHEN check_violation THEN
    v_res := v_res || jsonb_build_object('08_same_value_ok', 'FAIL: refused');
  END;

  -- 9. A retired seal can still be given its spec once (history stays drawable).
  INSERT INTO nfc_tags (id, tag_uid, chip_serial, sdm_key_version, seller_id, lifecycle_status, status)
  VALUES (v_old, 'FFAD0000SPEC09', upper(encode(extensions.gen_random_bytes(8), 'hex')), 2, v_admin, 'RETIRED', 'registered');
  SELECT seal_code INTO v_code FROM nfc_tags WHERE id = v_old;
  BEGIN
    UPDATE nfc_tags SET seal_spec = jsonb_build_object('v', 1, 'code', v_code) WHERE id = v_old;
    v_res := v_res || jsonb_build_object('09_retired_first_write_ok', 'ok');
  EXCEPTION WHEN check_violation THEN
    v_res := v_res || jsonb_build_object('09_retired_first_write_ok', 'FAIL: ' || SQLERRM);
  END;

  -- 10. Other write-once columns still hold (the trigger body was replaced).
  BEGIN
    UPDATE nfc_tags SET seal_code = '00000001' WHERE id = v_tag;
    v_res := v_res || jsonb_build_object('10_seal_code_still_write_once', 'FAIL: no error');
  EXCEPTION WHEN check_violation THEN
    v_res := v_res || jsonb_build_object('10_seal_code_still_write_once', 'ok');
  END;

  -- 11. No grants change: anon and authenticated get seal_spec exactly as they get seal_code.
  v_ok := has_column_privilege('anon', 'nfc_tags', 'seal_spec', 'SELECT') = has_column_privilege('anon', 'nfc_tags', 'seal_code', 'SELECT')
      AND has_column_privilege('authenticated', 'nfc_tags', 'seal_spec', 'SELECT') = has_column_privilege('authenticated', 'nfc_tags', 'seal_code', 'SELECT')
      AND has_column_privilege('anon', 'nfc_tags', 'seal_spec', 'UPDATE') = has_column_privilege('anon', 'nfc_tags', 'seal_code', 'UPDATE')
      AND has_column_privilege('authenticated', 'nfc_tags', 'seal_spec', 'UPDATE') = has_column_privilege('authenticated', 'nfc_tags', 'seal_code', 'UPDATE');
  v_res := v_res || jsonb_build_object('11_grants_same_as_seal_code', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 12. anon reads no nfc_tags row (RLS), so it never sees a spec.
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM nfc_tags WHERE id = v_tag;
    v_ok := NOT FOUND;
  EXCEPTION WHEN insufficient_privilege THEN
    v_ok := true;
  END;
  RESET ROLE;
  v_res := v_res || jsonb_build_object('12_anon_reads_nothing', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  RAISE EXCEPTION 'RESULTS %', v_res;
END $$;
