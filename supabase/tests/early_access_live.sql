-- S-SITE2 early-access signup — live checks for 20261028000002.
--
-- Leaves NOTHING behind: one DO block that ends by raising an exception with
-- the results, so the throwaway row rolls back.
--
-- Run: supabase db query --linked -f supabase/tests/early_access_live.sql
-- Expect: ERROR  P0001: RESULTS {"ok": 9, "total": 9, "failures": {}}

DO $$
DECLARE
  v_ok  BOOLEAN;
  v_res JSONB := '{}'::jsonb;
  v_n   INT;
BEGIN
  -- 01. New columns exist.
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'waitlist_signups'
     AND column_name IN ('consent_text', 'consent_at', 'unsubscribed_at', 'welcome_sent_at');
  v_res := v_res || jsonb_build_object('01_columns', CASE WHEN v_n = 4 THEN 'ok' ELSE 'FAIL ' || v_n END);

  -- 02. Webhook trigger gone.
  v_ok := NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                       WHERE c.relname = 'waitlist_signups' AND t.tgname = 'waitlist_welcome');
  v_res := v_res || jsonb_build_object('02_webhook_trigger_dropped', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 03. Open insert policy gone; admin read policy kept.
  v_ok := NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.waitlist_signups'::regclass AND polcmd = 'a')
      AND EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.waitlist_signups'::regclass AND polcmd = 'r');
  v_res := v_res || jsonb_build_object('03_policies', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 04-07. anon / authenticated cannot write or (anon) read.
  v_ok := NOT has_table_privilege('anon', 'public.waitlist_signups', 'INSERT');
  v_res := v_res || jsonb_build_object('04_anon_no_insert', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);
  v_ok := NOT has_table_privilege('authenticated', 'public.waitlist_signups', 'INSERT');
  v_res := v_res || jsonb_build_object('05_auth_no_insert', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);
  v_ok := NOT has_table_privilege('authenticated', 'public.waitlist_signups', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.waitlist_signups', 'DELETE');
  v_res := v_res || jsonb_build_object('06_auth_no_update_delete', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);
  v_ok := NOT has_table_privilege('anon', 'public.waitlist_signups', 'SELECT');
  v_res := v_res || jsonb_build_object('07_anon_no_select', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 08. service_role can still write (the backend path), and a duplicate email is refused.
  INSERT INTO public.waitlist_signups (email, source, consent_text, consent_at)
  VALUES ('early-access-live@example.invalid', 'home', 'test wording', now());
  BEGIN
    INSERT INTO public.waitlist_signups (email, source) VALUES ('early-access-live@example.invalid', 'home');
    v_ok := false;
  EXCEPTION WHEN unique_violation THEN v_ok := true;
  END;
  v_res := v_res || jsonb_build_object('08_unique_email', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 09. created_at index present.
  v_ok := EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'waitlist_signups' AND indexname = 'waitlist_signups_created_at_idx');
  v_res := v_res || jsonb_build_object('09_created_at_index', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  RAISE EXCEPTION 'RESULTS %', jsonb_build_object(
    'ok', (SELECT count(*) FROM jsonb_each_text(v_res) WHERE value = 'ok'),
    'total', (SELECT count(*) FROM jsonb_each_text(v_res)),
    'failures', (SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) FROM jsonb_each_text(v_res) WHERE value <> 'ok'));
END $$;
