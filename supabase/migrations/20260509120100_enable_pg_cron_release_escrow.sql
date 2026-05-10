-- Enable pg_cron + pg_net and schedule the release-escrow Edge Function.
--
-- Without this, the release-escrow function is never invoked automatically,
-- which means Phase 7D's stripe.transfers.create() never fires for eligible
-- settlements.
--
-- Secret handling: the function requires header `x-release-secret` matching
-- env var `RELEASE_ESCROW_SECRET`. The cron job pulls that same value from
-- Supabase Vault (`vault.decrypted_secrets`) at execution time. The vault
-- pattern mirrors the existing `reconcile-escrow-daily` cron (jobid=2) and
-- replaces an earlier draft that used `current_setting('app.*', true)` —
-- Supabase managed Postgres blocks custom-namespace GUCs (no ALTER DATABASE
-- / ALTER ROLE permission on the platform).
--
-- BEFORE applying this migration to prod, Boss must:
--   1. Set the edge function env var:
--        Supabase Dashboard → Edge Functions → release-escrow → Secrets
--        Add RELEASE_ESCROW_SECRET = <generated value>
--   2. Insert the same value into Supabase Vault as `release_escrow_secret`.
--      One-shot via the Supabase MCP (or the SQL editor):
--        SELECT vault.create_secret(
--          '<generated value>',
--          'release_escrow_secret',
--          'Shared secret for the pg_cron release-escrow tick. Rotate at prod cutover.'
--        );
--      The vault must already contain `supabase_url` (it does — used by
--      reconcile-escrow-daily) for the URL lookup below to resolve.
--
-- Tick cadence: every 15 minutes. Bump to '*/5 * * * *' once load and timing
-- are confirmed safe.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Idempotency: drop any prior schedule with the same jobname before re-creating.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'release-escrow-tick') THEN
    PERFORM cron.unschedule('release-escrow-tick');
  END IF;
END $$;

SELECT cron.schedule(
  'release-escrow-tick',
  '*/15 * * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url')
            || '/functions/v1/release-escrow',
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'x-release-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'release_escrow_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) AS request_id;
  $cron$
);
