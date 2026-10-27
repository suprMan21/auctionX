-- Admin console UX-3, AC 6 — dashboard growth.
--
-- admin_growth_series: how many tokens or accounts were created per day or per
-- month, in the viewer's time zone, plus three headline counts. Counts only:
-- no emails, ids, UIDs, serials or chip names ever leave this function, so it
-- writes no audit row.
--
--   p_series  'tokens'   nfc_tags.registered_at    needs manage_nfc
--             'accounts' users.created_at          needs view_users
--   p_from / p_to  local dates in p_tz, both inclusive, p_from <= p_to
--   p_bucket  'day'   at most 366 days
--             'month' at most 60 months (p_from's month .. p_to's month);
--                     the last bucket is the WHOLE month containing p_to and
--                     the first is the whole month containing p_from.
--   p_tz      a name in pg_timezone_names
--
-- A bucket starting at local date d covers
--   [d::timestamp AT TIME ZONE p_tz, next_d::timestamp AT TIME ZONE p_tz)
-- so a bucket follows the viewer's midnight, DST included.
--
-- Returns
--   { series, bucket, tz, from, to,
--     addedToday,   created since the start of today in p_tz
--     active,       tokens: lifecycle_status = 'ACTIVE';
--                   accounts: not retired and not currently suspended
--     totalBefore,  created before the start of the first bucket
--     points: [{ start: 'YYYY-MM-DD', count }] }   zero-filled, in order
--
-- The API (backend/src/controllers/adminStatsController.ts) checks every rule
-- below first; this function re-checks them all so a direct call cannot get
-- around them. Every IF coalesces: a NULL condition would otherwise pass.

CREATE OR REPLACE FUNCTION public.admin_growth_series(
  p_admin  UUID,
  p_series TEXT,
  p_from   DATE,
  p_to     DATE,
  p_bucket TEXT,
  p_tz     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first       DATE;          -- local date the first bucket starts
  v_after_last  DATE;          -- local date after the last bucket ends
  v_step        INTERVAL;
  v_range_start TIMESTAMPTZ;
  v_range_end   TIMESTAMPTZ;
  v_today_start TIMESTAMPTZ;
  v_added_today BIGINT;
  v_active      BIGINT;
  v_before      BIGINT;
  v_points      JSONB;
BEGIN
  -- Permission first. An unknown series maps to NULL, which admin_actor_email
  -- refuses as admin_forbidden.
  PERFORM admin_actor_email(p_admin, CASE p_series WHEN 'tokens' THEN 'manage_nfc' WHEN 'accounts' THEN 'view_users' END);

  IF coalesce(p_series NOT IN ('tokens', 'accounts'), true) THEN
    RAISE EXCEPTION 'invalid_series' USING ERRCODE = 'check_violation';
  END IF;
  IF coalesce(p_bucket NOT IN ('day', 'month'), true) THEN
    RAISE EXCEPTION 'invalid_bucket' USING ERRCODE = 'check_violation';
  END IF;
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'invalid_range' USING ERRCODE = 'check_violation';
  END IF;
  IF p_from > p_to THEN
    RAISE EXCEPTION 'range_reversed' USING ERRCODE = 'check_violation';
  END IF;
  IF p_bucket = 'day' AND (p_to - p_from + 1) > 366 THEN
    RAISE EXCEPTION 'range_too_long' USING ERRCODE = 'check_violation';
  END IF;
  IF p_bucket = 'month'
     AND ((extract(year FROM p_to)::int - extract(year FROM p_from)::int) * 12
          + extract(month FROM p_to)::int - extract(month FROM p_from)::int + 1) > 60 THEN
    RAISE EXCEPTION 'range_too_long' USING ERRCODE = 'check_violation';
  END IF;
  IF p_tz IS NULL OR length(p_tz) > 64 OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_tz) THEN
    RAISE EXCEPTION 'invalid_tz' USING ERRCODE = 'check_violation';
  END IF;

  IF p_bucket = 'day' THEN
    v_first      := p_from;
    v_after_last := p_to + 1;
    v_step       := interval '1 day';
  ELSE
    v_first      := date_trunc('month', p_from::timestamp)::date;
    v_after_last := (date_trunc('month', p_to::timestamp) + interval '1 month')::date;
    v_step       := interval '1 month';
  END IF;

  v_range_start := v_first::timestamp AT TIME ZONE p_tz;
  v_range_end   := v_after_last::timestamp AT TIME ZONE p_tz;
  v_today_start := ((now() AT TIME ZONE p_tz)::date)::timestamp AT TIME ZONE p_tz;

  IF p_series = 'tokens' THEN
    SELECT count(*) FILTER (WHERE t.registered_at >= v_today_start),
           count(*) FILTER (WHERE t.lifecycle_status = 'ACTIVE'),
           count(*) FILTER (WHERE t.registered_at < v_range_start)
      INTO v_added_today, v_active, v_before
      FROM nfc_tags t;

    SELECT coalesce(jsonb_agg(jsonb_build_object('start', to_char(b.d, 'YYYY-MM-DD'), 'count', coalesce(c.n, 0))
                              ORDER BY b.d), '[]'::jsonb)
      INTO v_points
      FROM generate_series(v_first::timestamp, v_after_last::timestamp - v_step, v_step) AS b(d)
      LEFT JOIN (
        SELECT CASE WHEN p_bucket = 'day'
                    THEN (t.registered_at AT TIME ZONE p_tz)::date
                    ELSE date_trunc('month', t.registered_at AT TIME ZONE p_tz)::date END AS d,
               count(*) AS n
          FROM nfc_tags t
         WHERE t.registered_at >= v_range_start AND t.registered_at < v_range_end
         GROUP BY 1
      ) c ON c.d = b.d::date;
  ELSE
    SELECT count(*) FILTER (WHERE u.created_at >= v_today_start),
           count(*) FILTER (WHERE u.retired_at IS NULL
                              AND NOT (coalesce(u.is_suspended, false)
                                       AND (u.suspended_until IS NULL OR u.suspended_until > now()))),
           count(*) FILTER (WHERE u.created_at < v_range_start)
      INTO v_added_today, v_active, v_before
      FROM users u;

    SELECT coalesce(jsonb_agg(jsonb_build_object('start', to_char(b.d, 'YYYY-MM-DD'), 'count', coalesce(c.n, 0))
                              ORDER BY b.d), '[]'::jsonb)
      INTO v_points
      FROM generate_series(v_first::timestamp, v_after_last::timestamp - v_step, v_step) AS b(d)
      LEFT JOIN (
        SELECT CASE WHEN p_bucket = 'day'
                    THEN (u.created_at AT TIME ZONE p_tz)::date
                    ELSE date_trunc('month', u.created_at AT TIME ZONE p_tz)::date END AS d,
               count(*) AS n
          FROM users u
         WHERE u.created_at >= v_range_start AND u.created_at < v_range_end
         GROUP BY 1
      ) c ON c.d = b.d::date;
  END IF;

  RETURN jsonb_build_object(
    'series',      p_series,
    'bucket',      p_bucket,
    'tz',          p_tz,
    'from',        to_char(p_from, 'YYYY-MM-DD'),
    'to',          to_char(p_to, 'YYYY-MM-DD'),
    'addedToday',  v_added_today,
    'active',      v_active,
    'totalBefore', v_before,
    'points',      v_points
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_growth_series(UUID, TEXT, DATE, DATE, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_growth_series(UUID, TEXT, DATE, DATE, TEXT, TEXT) TO service_role;
