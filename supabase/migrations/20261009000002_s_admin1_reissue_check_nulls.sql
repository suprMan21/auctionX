-- S-ADMIN1 Ph2 — fix two NULL holes in the 20261009000001 CHECKs.
--
-- Found by the live check (supabase/tests/s_admin1_ph2_live.sql, check 08):
-- a CHECK that evaluates to NULL passes. So
--   waive:   length(btrim(NULL)) >= 10            -> NULL -> a WAIVED row with no reason was accepted
--   fulfil:  NULL IN ('PAID','WAIVED')            -> NULL -> a fulfilled row with no payment state was accepted
-- Both are rewritten so NULL cannot satisfy them. The table has no WAIVED or
-- fulfilled rows yet, so re-adding the constraints cannot fail on existing data.
--
-- Idempotent: safe to re-run.

ALTER TABLE public.reissue_requests DROP CONSTRAINT IF EXISTS reissue_requests_waive_reason_chk;
ALTER TABLE public.reissue_requests
  ADD CONSTRAINT reissue_requests_waive_reason_chk
  CHECK (payment_status IS DISTINCT FROM 'WAIVED' OR coalesce(length(btrim(waive_reason)), 0) >= 10);

ALTER TABLE public.reissue_requests DROP CONSTRAINT IF EXISTS reissue_requests_fulfil_paid_chk;
ALTER TABLE public.reissue_requests
  ADD CONSTRAINT reissue_requests_fulfil_paid_chk
  CHECK (fulfilled_at IS NULL OR coalesce(payment_status, '') IN ('PAID', 'WAIVED'));
