-- =============================================================================
-- S-NFC1.5 (Lane E) — NFC ⇄ Listing Decoupling + Tag Lifecycle / Monetization
-- =============================================================================
-- ADDITIVE migration. Decouples NFC authentication from marketplace listings so
-- an item can exist and be verifiable with NO listing, and encodes the tag
-- lifecycle + transfer-fee / reclaim monetization model.
--
-- Schema Extension Rules honoured:
--   * Additive only — new tables + nullable columns; no removed/renamed/retyped
--     existing fields.
--   * Enum created in full via CREATE TYPE (NOT via ALTER TYPE ADD VALUE), so it
--     may be used as a column DEFAULT in this SAME transaction safely.
--   * The two RELAXATIONS that ARE applied (allowed per Boss directive, they do
--     not retype a column): item_verifications.listing_id NOT NULL -> NULLABLE,
--     and its FK ON DELETE CASCADE -> ON DELETE SET NULL.
--
-- Fully idempotent: every block guards with IF NOT EXISTS / duplicate_* catches.
-- Design doc: docs/S-NFC1_5_SCHEMA_DECOUPLING.md
-- =============================================================================


-- =============================================================================
-- 1. Lifecycle enum  (created whole — safe to use as DEFAULT in this txn)
-- =============================================================================
-- ENROLLED     : tag manufactured + AES key registered, not yet claimed by owner
-- CLAIMED      : an owner (email/user) has claimed the tag, no item linked yet
-- ASSOCIATED   : tag linked to an item (items.id) but not yet authenticated
-- ACTIVE       : item authenticated (video + on-chain), tag scans verify live
-- RELEASED     : owner-initiated PAID release that re-opens the tag for transfer
-- TRANSFERRED  : ownership moved to a new holder (token may be re-issued)
-- RETIRED      : tag permanently decommissioned (lost / destroyed / revoked)
DO $$ BEGIN
  CREATE TYPE nfc_lifecycle_status AS ENUM (
    'ENROLLED',
    'CLAIMED',
    'ASSOCIATED',
    'ACTIVE',
    'RELEASED',
    'TRANSFERRED',
    'RETIRED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


-- =============================================================================
-- 2. items — first-class authenticatable object (NO listing required)
-- =============================================================================
-- An item exists and is verifiable independent of any marketplace listing.
-- PUBLIC-FACING table: PII (phone / address) must NEVER be stored here. Owner-
-- controlled disclosure fields gate what a collector can see; verification is
-- owner-gated, not blanket public.
CREATE TABLE IF NOT EXISTS items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             TEXT NOT NULL DEFAULT 'auctionx',
  creator_id            UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- the author/creator
  title                 TEXT,
  description           TEXT,

  -- ── Owner-controlled disclosure (collectors see released fields only) ──────
  origin_released       BOOLEAN NOT NULL DEFAULT FALSE,  -- master gate for origin_* fields
  creator_name_visible  BOOLEAN NOT NULL DEFAULT FALSE,  -- show creator identity to collectors
  location_visibility   TEXT    NOT NULL DEFAULT 'HIDDEN',-- HIDDEN | POI | EXACT
  origin_video_url      TEXT,
  origin_event          TEXT,    -- e.g. "John Summit · EDC Las Vegas 2026" (POI)
  origin_date           DATE,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT items_location_visibility_chk
    CHECK (location_visibility IN ('HIDDEN', 'POI', 'EXACT'))
);

CREATE INDEX IF NOT EXISTS idx_items_tenant     ON items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_items_creator    ON items(creator_id);

-- updated_at trigger (function defined in an earlier migration)
DO $$ BEGIN
  CREATE TRIGGER set_items_updated_at
    BEFORE UPDATE ON items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- =============================================================================
-- 3. nfc_tags — additive lifecycle + item-decoupling columns
-- =============================================================================
-- Existing `status TEXT` is left UNTOUCHED (additive). `lifecycle_status` is the
-- new structured field; mapping documented in the design doc + backfill below.
DO $$ BEGIN
  ALTER TABLE nfc_tags ADD COLUMN lifecycle_status nfc_lifecycle_status;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- New decoupled item pointer. We do NOT retype the existing `item_id` (which
-- still REFERENCES listings(id)); instead add `linked_item_id` -> items(id) to
-- avoid an FK-retype collision. The old listings-pointer `item_id` is DEPRECATED
-- (see design doc); reads should migrate to linked_item_id.
DO $$ BEGIN
  ALTER TABLE nfc_tags ADD COLUMN linked_item_id UUID REFERENCES items(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_nfc_tags_linked_item ON nfc_tags(linked_item_id);
CREATE INDEX IF NOT EXISTS idx_nfc_tags_lifecycle   ON nfc_tags(lifecycle_status);


-- =============================================================================
-- 4. item_verifications — decouple from listings, email-only ownership
-- =============================================================================
-- 4a. New nullable pointer to the first-class item.
DO $$ BEGIN
  ALTER TABLE item_verifications ADD COLUMN item_id UUID REFERENCES items(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_item_verifications_item_id ON item_verifications(item_id);

-- 4b. Email-only ownership: ownership can attach to an unregistered email.
--     current_owner_id stays nullable until that email registers.
DO $$ BEGIN
  ALTER TABLE item_verifications ADD COLUMN current_owner_email TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_item_verifications_owner_email ON item_verifications(current_owner_email);

-- 4c. Make listing_id NULLABLE (a verification no longer requires a listing).
--     Relaxing NOT NULL -> nullable is allowed (does not retype the column).
DO $$ BEGIN
  ALTER TABLE item_verifications ALTER COLUMN listing_id DROP NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

-- 4d. Drop ON DELETE CASCADE on listing_id and recreate it ON DELETE SET NULL,
--     so deleting a listing NEVER destroys an authentication record.
--     (Same column/type — only the FK action changes.)
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel  ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
  WHERE rel.relname = 'item_verifications'
    AND con.contype = 'f'
    AND att.attname = 'listing_id'
  LIMIT 1;

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE item_verifications DROP CONSTRAINT %I', v_conname);
  END IF;

  -- (Re)create with SET NULL only if no FK on listing_id currently exists.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
    WHERE rel.relname = 'item_verifications'
      AND con.contype = 'f'
      AND att.attname = 'listing_id'
  ) THEN
    ALTER TABLE item_verifications
      ADD CONSTRAINT item_verifications_listing_id_fkey
      FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE SET NULL;
  END IF;
END $$;


-- =============================================================================
-- 5. ownership_transfers — transfer fee + reclaim / re-issue model
-- =============================================================================
DO $$ BEGIN
  ALTER TABLE ownership_transfers ADD COLUMN transfer_fee_cents INTEGER;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ownership_transfers ADD COLUMN transfer_fee_paid BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- BUYER (default) | SELLER (SELLER when an app-mediated transfer covers an
-- outside cash sale and the seller absorbs the fee).
DO $$ BEGIN
  ALTER TABLE ownership_transfers ADD COLUMN fee_payer TEXT NOT NULL DEFAULT 'BUYER';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ownership_transfers
    ADD CONSTRAINT ownership_transfers_fee_payer_chk
    CHECK (fee_payer IN ('BUYER', 'SELLER'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- INTERNAL (default, app sale) | EXTERNAL_CASH (cash sale logged in app)
-- | PLUGIN (3rd-party plugin-mediated transfer).
DO $$ BEGIN
  ALTER TABLE ownership_transfers ADD COLUMN source TEXT NOT NULL DEFAULT 'INTERNAL';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ownership_transfers
    ADD CONSTRAINT ownership_transfers_source_chk
    CHECK (source IN ('INTERNAL', 'EXTERNAL_CASH', 'PLUGIN'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Reclaim path: when a cash transfer was skipped and the current holder later
-- reclaims, it requires re-verification of tag + product and issues a NEW token
-- (re-encode) at a full new-ticket fee.  is_reclaim=TRUE,
-- requires_reverification=TRUE, reissued_token=TRUE.
DO $$ BEGIN
  ALTER TABLE ownership_transfers ADD COLUMN is_reclaim BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ownership_transfers ADD COLUMN requires_reverification BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ownership_transfers ADD COLUMN reissued_token BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;


-- =============================================================================
-- 6. Backfill (idempotent / safe to re-run)
-- =============================================================================
-- 6a. Create one `items` row per existing verification that has no item yet,
--     deriving creator_id from seller_id and title from token_name.
INSERT INTO items (id, tenant_id, creator_id, title, created_at, updated_at)
SELECT
  gen_random_uuid(),
  'auctionx',
  iv.seller_id,
  iv.token_name,
  iv.created_at,
  iv.updated_at
FROM item_verifications iv
WHERE iv.item_id IS NULL;

-- 6b. Point each verification at the item we just minted for it.
--     Match on creator_id + title + created_at, which together are unique here
--     (token_name is UNIQUE on item_verifications), and only fill NULLs.
UPDATE item_verifications iv
SET item_id = i.id
FROM items i
WHERE iv.item_id IS NULL
  AND i.creator_id = iv.seller_id
  AND i.title      = iv.token_name
  AND i.created_at = iv.created_at;

-- 6c. Propagate the item pointer onto nfc_tags via their verification link.
UPDATE nfc_tags t
SET linked_item_id = iv.item_id
FROM item_verifications iv
WHERE t.verification_id = iv.id
  AND t.linked_item_id IS NULL
  AND iv.item_id IS NOT NULL;

-- 6d. Seed lifecycle_status from the existing TEXT status / activated_at.
--       active                 -> ACTIVE
--       registered (+activated)-> ACTIVE
--       registered             -> ENROLLED
--       anything else / unknown-> ENROLLED (safe floor)
UPDATE nfc_tags
SET lifecycle_status = CASE
    WHEN status = 'active'                                   THEN 'ACTIVE'::nfc_lifecycle_status
    WHEN status = 'registered' AND activated_at IS NOT NULL  THEN 'ACTIVE'::nfc_lifecycle_status
    WHEN status = 'registered'                               THEN 'ENROLLED'::nfc_lifecycle_status
    ELSE 'ENROLLED'::nfc_lifecycle_status
  END
WHERE lifecycle_status IS NULL;


-- =============================================================================
-- 7. Row Level Security
-- =============================================================================
-- 7a. items RLS — owner-gated disclosure.
--   Owner (creator) sees their full record. Collectors see a row only when the
--   owner has released origin (origin_released = TRUE). Restricted columns
--   (creator identity, exact location) are gated at the application layer per
--   creator_name_visible / location_visibility; NO PII columns exist on this
--   table so none can leak through SELECT *.
ALTER TABLE items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "items_creator_all"      ON items;
DROP POLICY IF EXISTS "items_public_read_released" ON items;

-- Creator has full access to their own items.
CREATE POLICY "items_creator_all"
  ON items FOR ALL
  USING (creator_id = auth.uid())
  WITH CHECK (creator_id = auth.uid());

-- Collectors / anon may read ONLY items whose owner released the origin.
-- Field-level gating (creator_name_visible, location_visibility) is enforced by
-- the API / view layer — these toggles decide which released columns are
-- surfaced; the row itself is readable once origin_released = TRUE.
CREATE POLICY "items_public_read_released"
  ON items FOR SELECT
  USING (origin_released = TRUE);

-- NOTE (design doc §RLS): a future hardened read path should expose collectors a
-- restricted VIEW that projects only released columns, rather than the base
-- table, so creator_name_visible / location_visibility are enforced in SQL.
