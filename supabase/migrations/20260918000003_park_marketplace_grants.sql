-- =============================================================================
-- S-ISO1 — Park the marketplace: unschedule crons + revoke client write grants
-- =============================================================================
-- The auction marketplace and the Unmentionables stream are PARKED per the
-- 2026-09-18 token-first pivot (Decisions DB, Locked). Code stays deployed but
-- dormant. NOTHING IS DELETED — no table, column, row, policy or function is
-- dropped here. Everything below is reversible with the SQL in
-- docs/PARKED_MARKETPLACE.md.
--
-- Boss confirmed 2026-09-18 that nothing uses the marketplace on
-- pmlofthmobglcfkqjtru (no demo auctions, no live data dependencies).
--
-- Two effects:
--   1. Marketplace pg_cron jobs are unscheduled, so no parked Edge Function is
--      invoked on a timer. (They also now answer 410 — see
--      supabase/functions/_shared/marketplaceGate.ts.)
--   2. anon and authenticated lose INSERT/UPDATE/DELETE on marketplace tables.
--      SELECT is deliberately retained so RLS remains the read gate and foreign
--      key integrity checks are unaffected. service_role is untouched.
-- =============================================================================


-- =============================================================================
-- 1. Unschedule marketplace cron jobs
-- =============================================================================
-- Re-schedule SQL is preserved verbatim in docs/PARKED_MARKETPLACE.md.
--   release-escrow-tick      */15 * * * *  (20260509120100_enable_pg_cron_release_escrow.sql:43)
--   reconcile-escrow-daily   0 2 * * *     (20260509150005_escrow_reconciliation.sql:87)
-- A settle-auction schedule was never active (commented out at
-- 20260301000001_auction_settlement.sql:241-244), and check-payment-window has
-- no schedule in any migration despite its header claiming one.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'release-escrow-tick') THEN
    PERFORM cron.unschedule('release-escrow-tick');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-escrow-daily') THEN
    PERFORM cron.unschedule('reconcile-escrow-daily');
  END IF;
EXCEPTION
  -- pg_cron may not be installed on a local/shadow instance. Parking is not
  -- worth failing a migration over.
  WHEN undefined_table THEN RAISE NOTICE 'cron.job not present — skipping unschedule';
  WHEN insufficient_privilege THEN RAISE NOTICE 'no privilege on cron.job — skipping unschedule';
END $$;


-- =============================================================================
-- 2. Revoke client write access on parked marketplace tables
-- =============================================================================
-- Derived from the CREATE TABLE inventory across supabase/migrations/, not
-- guessed. 24 tables. NOT revoked (token platform): users, items,
-- item_verifications, ownership_transfers, nfc_tags, verification_events,
-- notifications, notification_preferences, yoti_sessions, waitlist_signups,
-- admin_users, admin_roles, audit_logs.
-- (nfc_tags / verification_events / nft_metadata were revoked separately in
--  20260918000000_fix_nfc_rls_key_exposure.sql.)
DO $$
DECLARE
  t TEXT;
  parked TEXT[] := ARRAY[
    -- core marketplace
    'listings', 'listing_media', 'categories', 'auctions', 'bids',
    -- settlement + escrow
    'settlements', 'settlement_offers', 'payment_penalties', 'payouts',
    'escrow_reconciliation_logs',
    -- money
    'transactions', 'payments', 'payment_attempts', 'crypto_payments', 'refunds',
    'processor_config', 'processor_health',
    -- fulfilment
    'shipping_addresses',
    -- marketplace surfaces
    'saved_searches', 'conversations', 'messages', 'moderation_queue',
    -- legacy KYC doc pipeline (superseded by Yoti)
    'seller_verification_documents', 'seller_verification_reviews'
  ];
BEGIN
  FOREACH t IN ARRAY parked LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format(
        'REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon, authenticated', t);
    ELSE
      RAISE NOTICE 'table % not present — skipped', t;
    END IF;
  END LOOP;
END $$;


-- =============================================================================
-- 3. Documentation marker
-- =============================================================================
COMMENT ON TABLE listings IS
  'PARKED 2026-09-18 (S-ISO1, token-first pivot). Retained, not deleted. '
  'Client write grants revoked; service_role unaffected. '
  'Reversal procedure: docs/PARKED_MARKETPLACE.md.';
