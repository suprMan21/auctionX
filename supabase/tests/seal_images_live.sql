-- S-SEAL1 Ph2b — live checks of nfc_tags.seal_images_at and the seal-images tick on staging.
--
-- Leaves NOTHING behind: one DO block that ends by raising an exception
-- carrying the results, so every seed row rolls back.
--
-- Dry run (before db push): BEGIN; migration; this file; ROLLBACK;
--   (printf 'BEGIN;\n'; cat supabase/migrations/20261029000001_seal_images.sql supabase/tests/seal_images_live.sql; printf 'ROLLBACK;\n') > /tmp/x.sql
--   supabase db query --linked -f /tmp/x.sql
-- After push:  supabase db query --linked -f supabase/tests/seal_images_live.sql
-- Expect: ERROR  P0001: RESULTS {...} with every check "ok".

DO $$
DECLARE
  v_admin CONSTANT UUID := '2b3f1532-9345-4720-8fac-55d07517c78b';  -- super_admin
  v_tag   UUID := gen_random_uuid();
  v_old   UUID := gen_random_uuid();
  v_res   JSONB := '{}'::jsonb;
  v_at    TIMESTAMPTZ;
  v_type  TEXT;
  v_null  TEXT;
  v_ok    BOOLEAN;
  v_cmd   TEXT;
BEGIN
  -- 1. Column: optional timestamptz, empty for a new tag.
  SELECT data_type, is_nullable INTO v_type, v_null
    FROM information_schema.columns WHERE table_name = 'nfc_tags' AND column_name = 'seal_images_at';
  INSERT INTO nfc_tags (id, tag_uid, chip_serial, sdm_key_version, seller_id, lifecycle_status, status)
  VALUES (v_tag, 'FFAD0000IMG001', upper(encode(extensions.gen_random_bytes(8), 'hex')), 2, v_admin, 'ENROLLED', 'registered');
  SELECT seal_images_at INTO v_at FROM nfc_tags WHERE id = v_tag;
  v_res := v_res || jsonb_build_object('01_column_optional_timestamptz',
    CASE WHEN v_type = 'timestamp with time zone' AND v_null = 'YES' AND v_at IS NULL THEN 'ok' ELSE 'FAIL: ' || coalesce(v_type, 'missing') END);

  -- 2. Set and clear on a live tag (the backend's two writes).
  UPDATE nfc_tags SET seal_images_at = now() WHERE id = v_tag;
  UPDATE nfc_tags SET seal_images_at = NULL WHERE id = v_tag;
  SELECT seal_images_at INTO v_at FROM nfc_tags WHERE id = v_tag;
  v_res := v_res || jsonb_build_object('02_set_and_clear_ok', CASE WHEN v_at IS NULL THEN 'ok' ELSE 'FAIL' END);

  -- 3. A retired tag's mark can be cleared (freeze trigger does not guard it).
  INSERT INTO nfc_tags (id, tag_uid, chip_serial, sdm_key_version, seller_id, lifecycle_status, status, seal_images_at)
  VALUES (v_old, 'FFAD0000IMG003', upper(encode(extensions.gen_random_bytes(8), 'hex')), 2, v_admin, 'RETIRED', 'registered', now());
  BEGIN
    UPDATE nfc_tags SET seal_images_at = NULL WHERE id = v_old;
    v_res := v_res || jsonb_build_object('03_retired_clear_ok', 'ok');
  EXCEPTION WHEN check_violation THEN
    v_res := v_res || jsonb_build_object('03_retired_clear_ok', 'FAIL: ' || SQLERRM);
  END;

  -- 4. The retired freeze still holds for what it guards.
  BEGIN
    UPDATE nfc_tags SET lifecycle_status = 'ACTIVE' WHERE id = v_old;
    v_res := v_res || jsonb_build_object('04_retired_still_frozen', 'FAIL: no error');
  EXCEPTION WHEN check_violation THEN
    v_res := v_res || jsonb_build_object('04_retired_still_frozen', 'ok');
  END;

  -- 5. The two partial indexes exist.
  v_ok := EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'nfc_tags' AND indexname = 'nfc_tags_seal_images_missing_idx')
      AND EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'nfc_tags' AND indexname = 'nfc_tags_seal_images_stale_idx');
  v_res := v_res || jsonb_build_object('05_indexes', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 6. No grants change: anon and authenticated get seal_images_at exactly as they get seal_code.
  v_ok := has_column_privilege('anon', 'nfc_tags', 'seal_images_at', 'SELECT') = has_column_privilege('anon', 'nfc_tags', 'seal_code', 'SELECT')
      AND has_column_privilege('authenticated', 'nfc_tags', 'seal_images_at', 'SELECT') = has_column_privilege('authenticated', 'nfc_tags', 'seal_code', 'SELECT')
      AND has_column_privilege('anon', 'nfc_tags', 'seal_images_at', 'UPDATE') = has_column_privilege('anon', 'nfc_tags', 'seal_code', 'UPDATE')
      AND has_column_privilege('authenticated', 'nfc_tags', 'seal_images_at', 'UPDATE') = has_column_privilege('authenticated', 'nfc_tags', 'seal_code', 'UPDATE');
  v_res := v_res || jsonb_build_object('06_grants_same_as_seal_code', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 7. anon reads no nfc_tags row (RLS).
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM nfc_tags WHERE id = v_tag;
    v_ok := NOT FOUND;
  EXCEPTION WHEN insufficient_privilege THEN
    v_ok := true;
  END;
  RESET ROLE;
  v_res := v_res || jsonb_build_object('07_anon_reads_nothing', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 8. The tick is scheduled every 10 minutes, posting to the seal-images route with its own secret.
  SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'seal-images-tick';
  v_res := v_res || jsonb_build_object('08_tick_scheduled',
    CASE WHEN v_cmd LIKE '%/api/v1/internal/seal-images%' AND v_cmd LIKE '%seal_images_tick_secret%' AND v_cmd LIKE '%x-tick-secret%'
         AND (SELECT schedule FROM cron.job WHERE jobname = 'seal-images-tick') = '3-59/10 * * * *'
         THEN 'ok' ELSE 'FAIL: ' || coalesce(v_cmd, 'no job') END);

  -- 9. The fee sweep tick is untouched.
  v_res := v_res || jsonb_build_object('09_fee_sweep_tick_untouched',
    CASE WHEN EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'token-fee-sweep-tick') THEN 'ok' ELSE 'FAIL' END);

  RAISE EXCEPTION 'RESULTS %', v_res;
END $$;
