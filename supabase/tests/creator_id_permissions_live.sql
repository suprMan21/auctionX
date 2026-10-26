-- Live checks for 20261026000002/3 (creator ID permissions). Read-only: one DO
-- block that ends by raising the results, so nothing persists.
-- Run: supabase db query --linked -f supabase/tests/creator_id_permissions_live.sql
-- Expect: ERROR  P0001: RESULTS {"ok": 4, "total": 4, "failures": {}}

DO $$
DECLARE
  v_res JSONB := '{}'::jsonb;
  v_ok  BOOLEAN;
  perms CONSTANT TEXT := 'SELECT permissions::text[] FROM admin_roles WHERE role_name = $1';
  p     TEXT[];
BEGIN
  EXECUTE perms INTO p USING 'support';
  v_ok := p @> ARRAY['view_creator_ids'] AND NOT p && ARRAY['manage_creator_ids', 'review_sellers'];
  v_res := v_res || jsonb_build_object('01_support_view_only', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || p::text END);

  EXECUTE perms INTO p USING 'admin';
  v_ok := p @> ARRAY['view_creator_ids', 'manage_creator_ids'] AND NOT p && ARRAY['review_sellers'];
  v_res := v_res || jsonb_build_object('02_admin_view_and_change', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || p::text END);

  EXECUTE perms INTO p USING 'super_admin';
  v_ok := p @> ARRAY['view_creator_ids', 'manage_creator_ids', 'review_sellers'];
  v_res := v_res || jsonb_build_object('03_super_admin_all', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || p::text END);

  -- No duplicates after the (idempotent) grant.
  SELECT bool_and(cardinality(permissions) = (SELECT count(DISTINCT x) FROM unnest(permissions) x))
    INTO v_ok FROM admin_roles WHERE role_name IN ('super_admin', 'admin', 'support');
  v_res := v_res || jsonb_build_object('04_no_duplicates', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  RAISE EXCEPTION 'RESULTS %', (
    SELECT jsonb_build_object(
             'total', count(*),
             'ok', count(*) FILTER (WHERE value = '"ok"'::jsonb),
             'failures', coalesce(jsonb_object_agg(key, value) FILTER (WHERE value <> '"ok"'::jsonb), '{}'::jsonb))
      FROM jsonb_each(v_res));
END;
$$;
