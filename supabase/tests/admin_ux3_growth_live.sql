-- Admin console UX-3, AC 6 — live checks for 20261027000001 (admin_growth_series).
--
-- Leaves NOTHING behind: one DO block that ends by raising an exception with
-- the results, so every change (throwaway accounts, the role change) rolls back.
--
-- Bucket checks compare counts before and after inserting throwaway accounts,
-- so existing staging rows do not matter.
--
-- Run: supabase db query --linked -f supabase/tests/admin_ux3_growth_live.sql
-- Expect: ERROR  P0001: RESULTS {"ok": 16, "total": 16, "failures": {}}

DO $$
DECLARE
  v_super CONSTANT UUID := '2b3f1532-9345-4720-8fac-55d07517c78b';  -- super_admin
  v_user  CONSTANT UUID := '0b211aed-3cf9-4729-818d-f0ed88dd68b8';  -- test@ (not staff)
  v_staff CONSTANT UUID := '885d30e1-4322-49a8-8363-b7926991c58d';  -- test2@ (made support here)
  v_a     CONSTANT UUID := 'a3a3a3a3-0000-4000-8000-00000000a301';  -- throwaway accounts
  v_b     CONSTANT UUID := 'a3a3a3a3-0000-4000-8000-00000000a302';
  v_c     CONSTANT UUID := 'a3a3a3a3-0000-4000-8000-00000000a303';
  v_d     CONSTANT UUID := 'a3a3a3a3-0000-4000-8000-00000000a304';
  v_fn    CONSTANT TEXT := 'public.admin_growth_series(uuid, text, date, date, text, text)';
  TZ      CONSTANT TEXT := 'America/Toronto';
  R       CONSTANT TEXT := 'live check reason text';
  v_ok    BOOLEAN;
  v_state TEXT;
  v_j     JSONB;
  v_j2    JSONB;
  v_m     JSONB;
  v_m2    JSONB;
  v_n     BIGINT;
  v_res   JSONB := '{}'::jsonb;
BEGIN
  -- 01. Exists; service_role only.
  v_ok := to_regprocedure(v_fn) IS NOT NULL
      AND NOT has_function_privilege('anon', v_fn, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
      AND has_function_privilege('service_role', v_fn, 'EXECUTE');
  v_res := v_res || jsonb_build_object('01_function_service_only', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 02. A non-staff account is refused (and so is a NULL actor).
  v_state := 'none';
  BEGIN PERFORM admin_growth_series(v_user, 'accounts', '2026-10-01', '2026-10-30', 'day', TZ);
  EXCEPTION WHEN insufficient_privilege THEN v_state := '42501'; END;
  BEGIN PERFORM admin_growth_series(NULL, 'accounts', '2026-10-01', '2026-10-30', 'day', TZ);
  EXCEPTION WHEN insufficient_privilege THEN v_state := v_state || '+42501'; END;
  v_res := v_res || jsonb_build_object('02_non_admin_refused', CASE WHEN v_state = '42501+42501' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 03. Reversed range refused.
  v_state := 'none';
  BEGIN PERFORM admin_growth_series(v_super, 'accounts', '2026-10-05', '2026-10-04', 'day', TZ);
  EXCEPTION WHEN check_violation THEN v_state := SQLERRM; END;
  v_res := v_res || jsonb_build_object('03_reversed_refused', CASE WHEN v_state = 'range_reversed' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 04. Caps: 366 days ok / 367 refused; 60 months ok / 61 refused.
  v_state := '';
  BEGIN PERFORM admin_growth_series(v_super, 'accounts', '2025-10-27', '2026-10-27', 'day', TZ); v_state := 'ok366';
  EXCEPTION WHEN check_violation THEN v_state := 'refused366'; END;
  BEGIN PERFORM admin_growth_series(v_super, 'accounts', '2025-10-26', '2026-10-27', 'day', TZ); v_state := v_state || '+ran367';
  EXCEPTION WHEN check_violation THEN v_state := v_state || '+' || SQLERRM; END;
  BEGIN PERFORM admin_growth_series(v_super, 'accounts', '2021-11-30', '2026-10-01', 'month', TZ); v_state := v_state || '+ok60';
  EXCEPTION WHEN check_violation THEN v_state := v_state || '+refused60'; END;
  BEGIN PERFORM admin_growth_series(v_super, 'accounts', '2021-10-31', '2026-10-01', 'month', TZ); v_state := v_state || '+ran61';
  EXCEPTION WHEN check_violation THEN v_state := v_state || '+' || SQLERRM; END;
  v_res := v_res || jsonb_build_object('04_caps',
    CASE WHEN v_state = 'ok366+range_too_long+ok60+range_too_long' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 05. Time zone must be in pg_timezone_names.
  v_state := 'none';
  BEGIN PERFORM admin_growth_series(v_super, 'accounts', '2026-10-01', '2026-10-30', 'day', 'Mars/Olympus');
  EXCEPTION WHEN check_violation THEN v_state := SQLERRM; END;
  v_res := v_res || jsonb_build_object('05_bad_tz_refused', CASE WHEN v_state = 'invalid_tz' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 06. NULL / unknown parameters never slip through.
  v_state := '';
  BEGIN PERFORM admin_growth_series(v_super, NULL, '2026-10-01', '2026-10-30', 'day', TZ); v_state := v_state || 'ran';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN v_state := v_state || 'r'; END;
  BEGIN PERFORM admin_growth_series(v_super, 'listings', '2026-10-01', '2026-10-30', 'day', TZ); v_state := v_state || 'ran';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN v_state := v_state || 'r'; END;
  BEGIN PERFORM admin_growth_series(v_super, 'accounts', NULL, '2026-10-30', 'day', TZ); v_state := v_state || 'ran';
  EXCEPTION WHEN check_violation THEN v_state := v_state || 'r'; END;
  BEGIN PERFORM admin_growth_series(v_super, 'accounts', '2026-10-01', NULL, 'day', TZ); v_state := v_state || 'ran';
  EXCEPTION WHEN check_violation THEN v_state := v_state || 'r'; END;
  BEGIN PERFORM admin_growth_series(v_super, 'accounts', '2026-10-01', '2026-10-30', NULL, TZ); v_state := v_state || 'ran';
  EXCEPTION WHEN check_violation THEN v_state := v_state || 'r'; END;
  BEGIN PERFORM admin_growth_series(v_super, 'accounts', '2026-10-01', '2026-10-30', 'week', TZ); v_state := v_state || 'ran';
  EXCEPTION WHEN check_violation THEN v_state := v_state || 'r'; END;
  BEGIN PERFORM admin_growth_series(v_super, 'accounts', '2026-10-01', '2026-10-30', 'day', NULL); v_state := v_state || 'ran';
  EXCEPTION WHEN check_violation THEN v_state := v_state || 'r'; END;
  v_res := v_res || jsonb_build_object('06_null_and_unknown_params_refused', CASE WHEN v_state = 'rrrrrrr' THEN 'ok' ELSE 'FAIL ' || v_state END);

  -- 07. 30-day range: 30 consecutive zero-filled points from p_from.
  v_j := admin_growth_series(v_super, 'accounts', '2026-10-01', '2026-10-30', 'day', TZ);
  SELECT count(*) = 30 AND bool_and((p->>'start')::date = DATE '2026-10-01' + (i - 1)::int AND (p->>'count')::int >= 0)
    INTO v_ok
    FROM jsonb_array_elements(v_j->'points') WITH ORDINALITY AS t(p, i);
  v_res := v_res || jsonb_build_object('07_day_series_30', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || jsonb_array_length(v_j->'points') END);

  -- 08. 12 months: 12 points, each the 1st of the month.
  v_j := admin_growth_series(v_super, 'accounts', '2025-11-15', '2026-10-27', 'month', TZ);
  SELECT count(*) = 12 AND bool_and((p->>'start')::date = (DATE '2025-11-01' + make_interval(months => (i - 1)::int))::date)
    INTO v_ok
    FROM jsonb_array_elements(v_j->'points') WITH ORDINALITY AS t(p, i);
  v_res := v_res || jsonb_build_object('08_month_series_12', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || jsonb_array_length(v_j->'points') END);

  -- 09. Result keys are exactly the contract (and points carry only start + count).
  v_j := admin_growth_series(v_super, 'accounts', '2026-10-01', '2026-10-30', 'day', TZ);
  v_ok := (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_j) k)
          = ARRAY['active','addedToday','bucket','from','points','series','to','totalBefore','tz']
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_j->'points') p
                       WHERE (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) k) <> ARRAY['count','start'])
      AND v_j->>'from' = '2026-10-01' AND v_j->>'to' = '2026-10-30' AND v_j->>'tz' = TZ
      AND jsonb_typeof(v_j->'addedToday') = 'number' AND jsonb_typeof(v_j->'active') = 'number'
      AND jsonb_typeof(v_j->'totalBefore') = 'number';
  v_res := v_res || jsonb_build_object('09_contract_keys_only', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || v_j::text END);

  -- Snapshots before the throwaway accounts exist.
  v_j  := admin_growth_series(v_super, 'accounts', '2026-10-25', '2026-10-27', 'day', TZ);
  v_j2 := admin_growth_series(v_super, 'accounts', '2026-10-25', '2026-10-27', 'day', 'UTC');
  v_m  := admin_growth_series(v_super, 'accounts', '2026-10-01', '2026-11-30', 'month', TZ);
  v_n  := (admin_growth_series(v_super, 'accounts', '2026-10-27', '2026-10-27', 'day', TZ)->>'totalBefore')::bigint;

  --   a  2026-10-27 03:30Z = 2026-10-26 23:30 Toronto (EDT)   -> 10-26 Toronto, 10-27 UTC
  --   b  2026-10-27 04:30Z = 2026-10-27 00:30 Toronto (EDT)   -> 10-27 Toronto, 10-27 UTC
  --   c  2026-11-01 03:00Z = 2026-10-31 23:00 Toronto (EDT)   -> October in Toronto
  --   d  2026-11-02 04:30Z = 2026-11-01 23:30 Toronto (EST, after the DST change) -> November
  INSERT INTO users (id, email) VALUES
    (v_a, 'ux3-growth-a@example.invalid'), (v_b, 'ux3-growth-b@example.invalid'),
    (v_c, 'ux3-growth-c@example.invalid'), (v_d, 'ux3-growth-d@example.invalid');
  UPDATE users SET created_at = '2026-10-27 03:30:00+00' WHERE id = v_a;
  UPDATE users SET created_at = '2026-10-27 04:30:00+00' WHERE id = v_b;
  UPDATE users SET created_at = '2026-11-01 03:00:00+00' WHERE id = v_c;
  UPDATE users SET created_at = '2026-11-02 04:30:00+00' WHERE id = v_d;

  -- 10. Toronto day buckets follow local midnight: a -> 10-26, b -> 10-27.
  v_ok := (admin_growth_series(v_super, 'accounts', '2026-10-25', '2026-10-27', 'day', TZ)->'points')
          = jsonb_build_array(
              jsonb_build_object('start', '2026-10-25', 'count', (v_j->'points'->0->>'count')::int),
              jsonb_build_object('start', '2026-10-26', 'count', (v_j->'points'->1->>'count')::int + 1),
              jsonb_build_object('start', '2026-10-27', 'count', (v_j->'points'->2->>'count')::int + 1));
  v_res := v_res || jsonb_build_object('10_toronto_day_boundary', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 11. Same rows in UTC: both on 10-27.
  v_ok := (admin_growth_series(v_super, 'accounts', '2026-10-25', '2026-10-27', 'day', 'UTC')->'points')
          = jsonb_build_array(
              jsonb_build_object('start', '2026-10-25', 'count', (v_j2->'points'->0->>'count')::int),
              jsonb_build_object('start', '2026-10-26', 'count', (v_j2->'points'->1->>'count')::int),
              jsonb_build_object('start', '2026-10-27', 'count', (v_j2->'points'->2->>'count')::int + 2));
  v_res := v_res || jsonb_build_object('11_utc_day_boundary', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 12. Month buckets in Toronto: a, b, c -> October; d (across the DST change) -> November.
  v_m2 := admin_growth_series(v_super, 'accounts', '2026-10-01', '2026-11-30', 'month', TZ);
  v_ok := v_m2->'points' = jsonb_build_array(
              jsonb_build_object('start', '2026-10-01', 'count', (v_m->'points'->0->>'count')::int + 3),
              jsonb_build_object('start', '2026-11-01', 'count', (v_m->'points'->1->>'count')::int + 1));
  v_res := v_res || jsonb_build_object('12_month_boundary_and_dst', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || (v_m2->'points')::text END);

  -- 13. totalBefore counts rows created before local midnight of p_from (a, not b).
  v_ok := (admin_growth_series(v_super, 'accounts', '2026-10-27', '2026-10-27', 'day', TZ)->>'totalBefore')::bigint = v_n + 1;
  v_res := v_res || jsonb_build_object('13_total_before', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 14. Active accounts: a retired and a currently suspended account do not count;
  --     a suspension that has ended does.
  v_n := (v_j->>'active')::bigint;    -- before the throwaways
  UPDATE users SET retired_at = now() WHERE id = v_a;
  UPDATE users SET is_suspended = true, suspended_until = now() + interval '1 day' WHERE id = v_b;
  UPDATE users SET is_suspended = true, suspended_until = now() - interval '1 day' WHERE id = v_c;
  v_ok := (admin_growth_series(v_super, 'accounts', '2026-10-25', '2026-10-27', 'day', TZ)->>'active')::bigint = v_n + 2;
  v_res := v_res || jsonb_build_object('14_active_accounts', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 15. Tokens: active = lifecycle ACTIVE; 30 zero-filled day points.
  v_j := admin_growth_series(v_super, 'tokens', '2026-10-01', '2026-10-30', 'day', TZ);
  v_ok := (v_j->>'active')::bigint = (SELECT count(*) FROM nfc_tags WHERE lifecycle_status = 'ACTIVE')
      AND jsonb_array_length(v_j->'points') = 30
      AND v_j->>'series' = 'tokens';
  v_res := v_res || jsonb_build_object('15_tokens_series', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || v_j::text END);

  -- 16. Support (view_users, no manage_nfc): accounts yes, tokens no.
  PERFORM admin_set_account_role(v_super, v_staff, 'support', R);
  v_state := '';
  BEGIN PERFORM admin_growth_series(v_staff, 'accounts', '2026-10-01', '2026-10-30', 'day', TZ); v_state := 'accounts_ok';
  EXCEPTION WHEN insufficient_privilege THEN v_state := 'accounts_refused'; END;
  BEGIN PERFORM admin_growth_series(v_staff, 'tokens', '2026-10-01', '2026-10-30', 'day', TZ); v_state := v_state || '+tokens_ran';
  EXCEPTION WHEN insufficient_privilege THEN v_state := v_state || '+42501'; END;
  v_res := v_res || jsonb_build_object('16_support_accounts_not_tokens', CASE WHEN v_state = 'accounts_ok+42501' THEN 'ok' ELSE 'FAIL ' || v_state END);

  RAISE EXCEPTION 'RESULTS %', (
    SELECT jsonb_build_object(
             'total', count(*),
             'ok', count(*) FILTER (WHERE value = '"ok"'::jsonb),
             'failures', coalesce(jsonb_object_agg(key, value) FILTER (WHERE value <> '"ok"'::jsonb), '{}'::jsonb))
      FROM jsonb_each(v_res));
END;
$$;
