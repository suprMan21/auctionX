-- =============================================================================
-- HOTFIX — NFC RLS key exposure  (2026-09-18)
-- =============================================================================
-- CONFIRMED LIVE ON STAGING before this fix: an anonymous PostgREST caller
-- holding only the publishable key could read `nfc_tags.aes_key_enc` —
-- the per-tag AES key the entire SUN/SDM authentication scheme rests on.
--
--   GET /rest/v1/nfc_tags?select=id,status,aes_key_enc   apikey: <publishable>
--   -> HTTP 200, aes_key_enc returned
--
-- Two causes combine:
--   1. `nfc_tags_public_read` (20260307100000_nfc_session_l_schema.sql:44) is
--      FOR SELECT USING (status IN ('registered','active')) — no owner predicate.
--   2. `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon`
--      (20260201042342_remote_schema.sql:2411) auto-granted every later table,
--      and nothing in the tree ever REVOKEd.
-- `verification_events_public_read` is USING (true) on a table holding
-- ip_address / user_agent / scanned_by — same shape, PII instead of keys.
--
-- SAFE TO DROP THESE POLICIES: every backend read of these tables goes through
-- getServiceClient() (backend/src/controllers/nfcController.ts:20), which uses
-- the service-role key and bypasses RLS entirely. Neither the React frontend nor
-- the Flutter app queries these tables directly (verified by grep). The public
-- verify page is served by the backend, not by PostgREST.
--
-- ADDITIVE / REVERSIBLE: no column, table or data is touched. Re-grant SQL is in
-- docs/PARKED_MARKETPLACE.md. Schema Extension Rules honoured — nothing removed,
-- renamed or retyped.
-- =============================================================================


-- =============================================================================
-- 1. nfc_tags — replace the blanket public read with an owner-scoped one
-- =============================================================================
-- `seller_id` is the enroller. S-NFC3 adds `current_owner_id`; until then the
-- enroller is the only non-service principal with a legitimate read.
DROP POLICY IF EXISTS "nfc_tags_public_read" ON nfc_tags;

DO $$ BEGIN
  CREATE POLICY "nfc_tags_owner_read" ON nfc_tags
    FOR SELECT USING (auth.uid() = seller_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- =============================================================================
-- 2. verification_events — drop the USING (true) read
-- =============================================================================
-- Holds ip_address (INET), user_agent and scanned_by. Scan counts for the public
-- verify page are aggregated server-side by the service client, so no anon
-- SELECT policy is needed.
DROP POLICY IF EXISTS "verification_events_public_read" ON verification_events;

DO $$ BEGIN
  CREATE POLICY "verification_events_owner_read" ON verification_events
    FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM nfc_tags t
        WHERE t.id = verification_events.tag_id
          AND t.seller_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- =============================================================================
-- 3. Revoke direct write grants on the NFC tables
-- =============================================================================
-- Every write goes through the service-role backend. anon/authenticated never
-- need INSERT/UPDATE/DELETE here. SELECT is deliberately left in place so the
-- RLS policies above remain the thing that decides reads.
REVOKE INSERT, UPDATE, DELETE ON nfc_tags            FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON verification_events FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON nft_metadata        FROM anon, authenticated;


-- =============================================================================
-- 4. Stop future tables from silently re-opening
-- =============================================================================
-- ⚠️ BEHAVIOUR CHANGE FOR ALL FUTURE MIGRATIONS. Tables created by `postgres`
-- in `public` from here on are NOT write-granted to anon/authenticated by
-- default. SELECT is still granted by default, so RLS stays the read gate.
-- A future table that genuinely needs client-side writes must GRANT explicitly.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE ON TABLES FROM authenticated;


-- =============================================================================
-- 5. Documentation
-- =============================================================================
COMMENT ON COLUMN nfc_tags.aes_key_enc IS
  'Per-tag AES key material. NEVER expose to anon/authenticated and never log. '
  'Readable only via the service-role backend. See migration 20260918000000.';
