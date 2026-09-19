-- =============================================================================
-- S-NFC3 — Tag Management API (rev 2): schema
-- =============================================================================
-- Separate file from 20260919000001 so the enum values added there are
-- committed before anything references them (Every-Session lesson).
--
-- Every statement is idempotency-wrapped. Schema Extension Rules honoured:
-- nothing is removed, renamed or retyped.
--
-- TWO NULLABILITY RELAXATIONS ARE REQUIRED (see §1). Dropping NOT NULL widens
-- what the column accepts, so it cannot invalidate an existing row — the
-- inverse (making an optional field required) is what the rules forbid.
-- Precedent: 20260622000000_nfc_items_decoupling.sql:134 does exactly this to
-- `item_verifications.listing_id`.
-- =============================================================================


-- =============================================================================
-- 1. ownership_transfers — two-sided, paid transfer
-- =============================================================================
-- The table was built for the marketplace: a transfer was the consequence of a
-- settled auction, so it always had both a verification row and a registered
-- recipient. Under the token-first model neither holds:
--
--   verification_id NOT NULL REFERENCES item_verifications(id)
--     A token transfer has no item_verification. Forcing one would mean
--     fabricating a marketplace-era row per transfer.
--     (20260301100000_nfc_verification.sql:70)
--
--   to_user_id NOT NULL REFERENCES users(id)
--     Rule 3 of the brief: "A pending transfer can target an email with no
--     account; the recipient registers, then completes it." A PENDING transfer
--     to `to_email` has no user id yet, by design.
--     (20260301100000_nfc_verification.sql:72)
--
-- Both are relaxed to NULL. The CHECK at the end of this section keeps the
-- combination honest: a PENDING transfer needs exactly one target, and a
-- COMPLETED one always has a resolved user.
DO $$ BEGIN
  ALTER TABLE ownership_transfers ALTER COLUMN verification_id DROP NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE ownership_transfers ALTER COLUMN to_user_id DROP NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;

-- `tag_id`, `status` and `completed_at` already exist
-- (20260307100000_nfc_session_l_schema.sql:147,162,167). `status` is an
-- unconstrained TEXT; give it the rev 2 state set. Existing rows predate the
-- token model and may hold NULL, which the constraint allows.
DO $$ BEGIN
  ALTER TABLE ownership_transfers
    ADD CONSTRAINT ownership_transfers_status_chk
    CHECK (status IS NULL OR status IN ('PENDING', 'COMPLETED', 'CANCELLED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Recipient target when the recipient has no account yet. Lowercased on write
-- by the API so the unique-ish lookup is stable.
DO $$ BEGIN
  ALTER TABLE ownership_transfers ADD COLUMN to_email TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE ownership_transfers ADD COLUMN stripe_payment_intent_id TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- One PaymentIntent per transfer. The API also sets a Stripe idempotency key
-- derived from the transfer id; this index is the database-side backstop that
-- makes a duplicated webhook or a retried create impossible to double-apply.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ownership_transfers_payment_intent
  ON ownership_transfers(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- ─── FX / presentment currency ───────────────────────────────────────────────
-- Prices are listed in USD and charged in the account's billing currency. Every
-- fee row records what was listed, what was actually charged, and the rate used,
-- so a charge can be reconstructed months later without re-querying Stripe.
DO $$ BEGIN
  ALTER TABLE ownership_transfers ADD COLUMN list_amount_usd_cents INTEGER;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE ownership_transfers ADD COLUMN charged_amount INTEGER;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE ownership_transfers ADD COLUMN charged_currency TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE ownership_transfers
    ADD CONSTRAINT ownership_transfers_charged_currency_chk
    CHECK (charged_currency IS NULL OR charged_currency IN ('usd', 'cad'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- NUMERIC, not float: an FX rate is money-adjacent and must not carry binary
-- rounding error into a reconciliation.
DO $$ BEGIN
  ALTER TABLE ownership_transfers ADD COLUMN fx_rate NUMERIC(12, 6);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- `card` today. `credit` (Premier credits) is accepted by the column now so
-- S-TIER1 does not need a migration, but no code path writes it this session.
DO $$ BEGIN
  ALTER TABLE ownership_transfers ADD COLUMN payment_method TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE ownership_transfers
    ADD CONSTRAINT ownership_transfers_payment_method_chk
    CHECK (payment_method IS NULL OR payment_method IN ('card', 'credit'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE ownership_transfers ADD COLUMN initiated_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- A PENDING transfer must name exactly one recipient target; a COMPLETED one
-- must have resolved to a real account. NULL status = pre-token legacy row.
DO $$ BEGIN
  ALTER TABLE ownership_transfers
    ADD CONSTRAINT ownership_transfers_target_chk
    CHECK (
      status IS NULL
      OR (status = 'PENDING'   AND (to_user_id IS NOT NULL) <> (to_email IS NOT NULL))
      OR (status = 'COMPLETED' AND to_user_id IS NOT NULL)
      OR status = 'CANCELLED'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- At most one live transfer per tag. This is the database-side enforcement of
-- "once a transfer is initiated, the sender cannot release" — two concurrent
-- initiates cannot both win.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ownership_transfers_one_pending_per_tag
  ON ownership_transfers(tag_id)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_ownership_transfers_to_email
  ON ownership_transfers(lower(to_email))
  WHERE to_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ownership_transfers_status
  ON ownership_transfers(status);


-- =============================================================================
-- 2. nfc_tags — current owner + owner-controlled disclosure
-- =============================================================================
-- `seller_id` stays the ENROLLER (who encoded the chip) and is never rewritten.
-- `current_owner_id` is the holder, and moves on every completed transfer. The
-- S-ISO1 hotfix anticipated this column by name
-- (20260918000000_fix_nfc_rls_key_exposure.sql:35).
DO $$ BEGIN
  ALTER TABLE nfc_tags ADD COLUMN current_owner_id UUID REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_nfc_tags_current_owner ON nfc_tags(current_owner_id);

-- Which origin fields the public verify page may show. Owner-controlled;
-- everything defaults to hidden, so a tag that has never had its disclosure set
-- discloses nothing.
DO $$ BEGIN
  ALTER TABLE nfc_tags ADD COLUMN disclosure JSONB NOT NULL DEFAULT '{
    "origin_video": false,
    "creator_name": false,
    "claim_date":   false,
    "location":     false
  }'::jsonb;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- NOTE: the brief also asked for `nfc_tags.last_counter`. Not added — the SDM
-- read counter already lives in `nfc_tags.sun_counter`
-- (20260307100000_nfc_session_l_schema.sql:17) and is what the existing scan
-- path maintains. A second counter column would be a silent source of truth
-- split on the exact check Rule 2 depends on.


-- =============================================================================
-- 3. users.tier — account tier (Premier lands in S-TIER1)
-- =============================================================================
-- Distinct from `users.seller_tier` (tier_level: TIER_1/2/3), which is the
-- PARKED marketplace's fee bracket. Nothing is gated on `tier` this session.
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN tier TEXT NOT NULL DEFAULT 'standard';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE users
    ADD CONSTRAINT users_tier_chk CHECK (tier IN ('standard', 'premier'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- =============================================================================
-- 4. reissue_requests — admin-reviewed re-issue ($10)
-- =============================================================================
-- The only path for a holder who skipped a transfer. Not advertised in the UI.
CREATE TABLE IF NOT EXISTS reissue_requests (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_id                   UUID NOT NULL REFERENCES nfc_tags(id) ON DELETE CASCADE,
  requester_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status                   TEXT NOT NULL DEFAULT 'PENDING',
  stripe_payment_intent_id TEXT,
  list_amount_usd_cents    INTEGER,
  charged_amount           INTEGER,
  charged_currency         TEXT,
  fx_rate                  NUMERIC(12, 6),
  reviewed_by              UUID REFERENCES users(id),
  reviewed_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reissue_requests_status_chk
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  CONSTRAINT reissue_requests_currency_chk
    CHECK (charged_currency IS NULL OR charged_currency IN ('usd', 'cad'))
);

CREATE INDEX IF NOT EXISTS idx_reissue_requests_tag       ON reissue_requests(tag_id);
CREATE INDEX IF NOT EXISTS idx_reissue_requests_requester ON reissue_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_reissue_requests_status    ON reissue_requests(status);

-- One open request per tag per requester.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reissue_requests_one_open
  ON reissue_requests(tag_id, requester_id)
  WHERE status = 'PENDING';

DO $$ BEGIN
  CREATE TRIGGER set_reissue_requests_updated_at
    BEFORE UPDATE ON reissue_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- =============================================================================
-- 5. ownership_proofs — Ownership ID + Receipt
-- =============================================================================
-- ownership_id = keccak256(tag_ref || ownership_event_id || salt).
--
-- The preimage deliberately contains NO account id and NO personal data:
-- publishing an Ownership ID must reveal nothing about who holds the token.
-- `salt_enc` is the envelope-encrypted salt, kept so the owner can re-download
-- their Receipt; the plaintext salt is never stored and never logged.
--
-- Anchoring on-chain is S-ANCHOR1 — `anchored_tx_hash` / `anchored_at` are
-- written by nothing this session.
CREATE TABLE IF NOT EXISTS ownership_proofs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_id             UUID NOT NULL REFERENCES nfc_tags(id) ON DELETE CASCADE,
  -- The claim or transfer row this proof was minted for. Not an FK: a proof can
  -- originate from an origin claim (no ownership_transfers row exists) or from a
  -- completed transfer.
  ownership_event_id UUID NOT NULL,
  ownership_event_type TEXT NOT NULL,
  -- bytes32 as lowercase 0x-prefixed hex: 2 + 64 chars.
  ownership_id       TEXT NOT NULL UNIQUE,
  -- Non-UID stable reference to the tag used in the preimage. Never the chip UID.
  tag_ref            TEXT NOT NULL,
  salt_enc           TEXT NOT NULL,
  owner_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  status             TEXT NOT NULL DEFAULT 'current',
  anchored_tx_hash   TEXT,
  anchored_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ownership_proofs_status_chk CHECK (status IN ('current', 'stale')),
  CONSTRAINT ownership_proofs_id_format_chk CHECK (ownership_id ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT ownership_proofs_event_type_chk
    CHECK (ownership_event_type IN ('claim', 'transfer'))
);

CREATE INDEX IF NOT EXISTS idx_ownership_proofs_tag   ON ownership_proofs(tag_id);
CREATE INDEX IF NOT EXISTS idx_ownership_proofs_owner ON ownership_proofs(owner_id);

-- Exactly one `current` proof per tag: minting a new one must flip the old.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ownership_proofs_one_current_per_tag
  ON ownership_proofs(tag_id)
  WHERE status = 'current';


-- =============================================================================
-- 6. RLS
-- =============================================================================
-- Backend reads go through getServiceClient() (service role, bypasses RLS).
-- These policies exist so that a direct PostgREST call with the publishable key
-- cannot read anything it should not — the failure mode that produced the
-- S-ISO1 key-exposure hotfix.
ALTER TABLE reissue_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ownership_proofs  ENABLE ROW LEVEL SECURITY;

-- Requester-scoped read. No anon policy at all: no SELECT policy means no rows.
DO $$ BEGIN
  CREATE POLICY "reissue_requests_owner_read" ON reissue_requests
    FOR SELECT USING (auth.uid() = requester_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Owner-only read, service-role write. `salt_enc` lives here, so this policy is
-- the gate on Receipt material.
DO $$ BEGIN
  CREATE POLICY "ownership_proofs_owner_read" ON ownership_proofs
    FOR SELECT USING (auth.uid() = owner_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Writes are service-role only. Revoke the blanket grants the 2026-02-01
-- default-privileges statement would otherwise hand these new tables
-- (20260201042342_remote_schema.sql:2411) — the exact mechanism behind the
-- S-ISO1 key exposure. SELECT is kept so RLS stays the read gate.
REVOKE ALL     ON reissue_requests FROM anon, authenticated;
REVOKE ALL     ON ownership_proofs FROM anon, authenticated;
GRANT  SELECT  ON reissue_requests TO authenticated;
GRANT  SELECT  ON ownership_proofs TO authenticated;


-- =============================================================================
-- 7. public_tag_provenance — the ONLY source for the public verify page
-- =============================================================================
-- The verify page must never read base tables. This view is the redaction
-- boundary, enforced in SQL rather than in a controller that could forget:
--
--   * prior owners are absent, in any form
--   * the current owner is absent — ownership is account-bound and may be
--     anonymous; the page answers "is this token valid", not "who holds it"
--   * chip UID, aes_key_enc and sun_counter are absent
--   * each origin field resolves to NULL unless the owner disclosed it
--
-- security_invoker stays OFF (default) so the view reads base tables as its
-- owner; the grant below is what makes it readable, and it exposes no column
-- that RLS would otherwise have protected.
--
-- DOUBLE GATE — deliberate. Two different people control disclosure, and a
-- field appears only when BOTH have allowed it:
--
--   items.origin_released / creator_name_visible / location_visibility
--     set by the CREATOR of the item (S-NFC1.5), who decides what may ever be
--     published about the origin.
--   nfc_tags.disclosure
--     set by the CURRENT OWNER of the token (S-NFC3), who decides what their
--     particular verify page actually shows.
--
-- These are not redundant: the creator and the current owner are usually
-- different people, and neither should be able to override the other. The
-- conjunction is the restrictive direction, so a missing gate hides rather than
-- reveals.
--
-- `creator_name` resolves through items.creator_id — NOT nfc_tags.seller_id,
-- which is the staff member who encoded the chip and must never be published.
CREATE OR REPLACE VIEW public_tag_provenance AS
SELECT
  t.id                                                        AS tag_id,
  t.lifecycle_status,
  -- Terminal states stay visible and explicitly invalid rather than 404ing, so
  -- a scan of a released tag can say so instead of looking like an unknown tag.
  (t.lifecycle_status = 'ACTIVE')                             AS is_valid,
  CASE WHEN t.disclosure->>'claim_date' = 'true'
       THEN t.activated_at END                                AS claim_date,
  CASE WHEN t.disclosure->>'creator_name' = 'true'
        AND i.creator_name_visible
       THEN c.username END                                    AS creator_name,
  CASE WHEN t.disclosure->>'origin_video' = 'true'
        AND i.origin_released
       THEN i.origin_video_url END                            AS origin_video_url,
  -- POI-level only. `origin_event` is the human POI string ("John Summit · EDC
  -- Las Vegas 2026"); no exact coordinates exist anywhere in `items`, so EXACT
  -- and POI both resolve to the same non-precise value.
  CASE WHEN t.disclosure->>'location' = 'true'
        AND i.location_visibility <> 'HIDDEN'
       THEN i.origin_event END                                AS origin_location,
  CASE WHEN t.disclosure->>'origin_video' = 'true'
        AND i.origin_released
       THEN i.origin_date END                                 AS origin_date,
  p.ownership_id                                              AS current_ownership_id,
  t.created_at                                                AS enrolled_at
FROM nfc_tags t
LEFT JOIN items i ON i.id = t.linked_item_id
LEFT JOIN users c ON c.id = i.creator_id
LEFT JOIN ownership_proofs p ON p.tag_id = t.id AND p.status = 'current';

GRANT SELECT ON public_tag_provenance TO anon, authenticated;

COMMENT ON VIEW public_tag_provenance IS
  'S-NFC3: the only permitted source for the public verify page. Never exposes '
  'prior owners, the current owner, chip UID, aes_key_enc or undisclosed origin '
  'fields. Add a column here only with the disclosure gate applied.';
