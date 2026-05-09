-- Phase 7C: Escrow Reconciliation Watchdog
--
-- Adds:
--  1. manage_escrow admin permission (idempotent enum append)
--  2. escrow_reconciliation_logs table — daily summaries of the reconcile-escrow run
--  3. pg_cron daily schedule that POSTs to /functions/v1/reconcile-escrow at 02:00 UTC
--
-- Notes:
--  - Per Lessons Learned #3 (enum + RLS same transaction): the RLS policy uses the
--    project's existing `is_admin_with_permission(uuid, text)` helper which compares
--    via text, so we don't cast to the new enum value in the same transaction that
--    adds it. (admin_users in this project is keyed by admin_id, NOT user_id, and
--    permissions live on admin_roles via role_id — going through the helper avoids
--    coupling this migration to that join.)
--  - pg_cron credentials read from Supabase Vault. Run vault.create_secret() for
--    'supabase_url' and 'service_role_key' BEFORE applying this migration, otherwise
--    the cron job will run but get NULL credentials.

-- ─── 1. Enable required extensions ─────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ─── 2. Idempotent enum append: manage_escrow ─────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'manage_escrow'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'admin_permission')
  ) THEN
    ALTER TYPE public.admin_permission ADD VALUE 'manage_escrow';
  END IF;
END $$;

-- ─── 3. Reconciliation logs table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.escrow_reconciliation_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at            timestamptz NOT NULL DEFAULT now(),
  total_checked     int NOT NULL DEFAULT 0,
  stuck_released    int NOT NULL DEFAULT 0,   -- ESCROW_HOLD past escrow_ends_at, re-driven to RELEASED
  orphaned_flagged  int NOT NULL DEFAULT 0,   -- ESCROW_HOLD with no successful transaction
  disputed_aged     int NOT NULL DEFAULT 0,   -- DISPUTED > 7 days
  errors            jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary           text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_escrow_reconciliation_logs_run_at
  ON public.escrow_reconciliation_logs (run_at DESC);

ALTER TABLE public.escrow_reconciliation_logs ENABLE ROW LEVEL SECURITY;

-- Admins with manage_escrow can read logs. Reuses the existing
-- is_admin_with_permission(uuid, text) helper to stay decoupled from the
-- admin_users / admin_roles join shape and avoid the enum-cast pitfall.
DROP POLICY IF EXISTS "admin_read_reconciliation_logs" ON public.escrow_reconciliation_logs;
CREATE POLICY "admin_read_reconciliation_logs"
  ON public.escrow_reconciliation_logs FOR SELECT
  USING (is_admin_with_permission(auth.uid(), 'manage_escrow'));

-- Service role bypasses RLS for inserts (the edge function uses the service key).
-- No insert policy needed for clients — only the edge function writes here.

COMMENT ON TABLE public.escrow_reconciliation_logs IS
  'Per-run summary written by the reconcile-escrow edge function. One row per daily run.';

-- ─── 4. pg_cron schedule (Vault-backed credentials) ───────────────────────
-- Unschedule any prior version of this job so re-applying the migration is idempotent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-escrow-daily') THEN
    PERFORM cron.unschedule('reconcile-escrow-daily');
  END IF;
END $$;

-- Schedule the daily run at 02:00 UTC.
-- Vault secrets must exist beforehand:
--   SELECT vault.create_secret('https://pmlofthmobglcfkqjtru.supabase.co', 'supabase_url', '');
--   SELECT vault.create_secret('<SERVICE_ROLE_KEY>',                       'service_role_key', '');
SELECT cron.schedule(
  'reconcile-escrow-daily',
  '0 2 * * *',
  $cron$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url')
              || '/functions/v1/reconcile-escrow',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $cron$
);
