-- =============================================================================
-- S-NFC3 — Tag Management API (rev 2): enum values ONLY
-- =============================================================================
-- This file adds enum values and NOTHING else.
--
-- Lesson (Every Session, Critical): `supabase db push` runs all pending
-- migrations in ONE transaction, and PostgreSQL cannot use a new enum value in
-- the same transaction that adds it. Any DDL or DML referencing these values
-- therefore lives in 20260919000002, which is a separate file and so a separate
-- transaction.
--
-- Timestamp note: the brief called these 20260918000001/2, but 20260918000003
-- (park_marketplace_grants) is ALREADY APPLIED on staging. Inserting a lower
-- version behind an applied one puts the CLI into out-of-order migration
-- territory, so these are renumbered to 20260919*.
--
-- Verified against the live schema, not the brief:
--   nfc_lifecycle_status = ENROLLED, CLAIMED, ASSOCIATED, ACTIVE, RELEASED,
--                          TRANSFERRED, RETIRED
--     (20260622000000_nfc_items_decoupling.sql:33)
--     -> RELEASED already exists; SUSPENDED is MISSING and added here.
--     -> The brief's "tag_lifecycle_status" is not the real type name.
--   transfer_type        = PURCHASE, SALE, GIFT, RETURN
--     (20260301100000_nfc_verification.sql:29-40)
--     -> GIFT already exists; RELEASE and REISSUE are added here.
-- =============================================================================

-- ─── nfc_lifecycle_status ────────────────────────────────────────────────────
-- SUSPENDED: admin hold. ACTIVE -> SUSPENDED -> ACTIVE, per the rev 2 lifecycle
-- diagram. Not terminal, unlike RELEASED and RETIRED.
DO $$ BEGIN
  ALTER TYPE nfc_lifecycle_status ADD VALUE IF NOT EXISTS 'SUSPENDED';
EXCEPTION WHEN others THEN NULL; END $$;

-- ─── transfer_type ───────────────────────────────────────────────────────────
-- RELEASE: owner permanently killed the token (terminal, free, no recipient).
-- REISSUE: admin-reviewed re-issue for a holder who skipped a transfer ($10).
DO $$ BEGIN
  ALTER TYPE transfer_type ADD VALUE IF NOT EXISTS 'RELEASE';
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE transfer_type ADD VALUE IF NOT EXISTS 'REISSUE';
EXCEPTION WHEN others THEN NULL; END $$;
