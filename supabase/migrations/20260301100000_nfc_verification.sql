-- Module 13: NFC Verification System
-- Creates item_verifications, ownership_transfers tables and supporting infrastructure
-- Fully idempotent: safe to re-run if a previous push was interrupted.

-- ─── Enums ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE verification_status AS ENUM (
    'PENDING',
    'VIDEO_UPLOADED',
    'NFC_PROGRAMMED',
    'VERIFIED',
    'FLAGGED',
    'REVOKED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Ensure all values exist (handles partial prior creation)
DO $$ BEGIN ALTER TYPE verification_status ADD VALUE IF NOT EXISTS 'PENDING';        EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE verification_status ADD VALUE IF NOT EXISTS 'VIDEO_UPLOADED'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE verification_status ADD VALUE IF NOT EXISTS 'NFC_PROGRAMMED'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE verification_status ADD VALUE IF NOT EXISTS 'VERIFIED';       EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE verification_status ADD VALUE IF NOT EXISTS 'FLAGGED';        EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE verification_status ADD VALUE IF NOT EXISTS 'REVOKED';        EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE transfer_type AS ENUM (
    'SALE',
    'GIFT',
    'RETURN'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN ALTER TYPE transfer_type ADD VALUE IF NOT EXISTS 'SALE';   EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE transfer_type ADD VALUE IF NOT EXISTS 'GIFT';   EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE transfer_type ADD VALUE IF NOT EXISTS 'RETURN'; EXCEPTION WHEN others THEN NULL; END $$;

-- ─── item_verifications ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS item_verifications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id            UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  seller_id             UUID NOT NULL REFERENCES users(id),
  token_name            TEXT NOT NULL UNIQUE,
  nfc_tag_uid           TEXT,
  video_url             TEXT,
  video_duration_seconds INTEGER,
  status                verification_status NOT NULL DEFAULT 'PENDING',
  scan_count            INTEGER NOT NULL DEFAULT 0,
  view_count            INTEGER NOT NULL DEFAULT 0,
  share_count           INTEGER NOT NULL DEFAULT 0,
  current_owner_id      UUID REFERENCES users(id),
  nfc_programmed_at     TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_item_verifications_listing_id       ON item_verifications(listing_id);
CREATE INDEX IF NOT EXISTS idx_item_verifications_seller_id        ON item_verifications(seller_id);
CREATE INDEX IF NOT EXISTS idx_item_verifications_current_owner_id ON item_verifications(current_owner_id);
CREATE INDEX IF NOT EXISTS idx_item_verifications_status           ON item_verifications(status);

-- ─── ownership_transfers ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ownership_transfers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id  UUID NOT NULL REFERENCES item_verifications(id) ON DELETE CASCADE,
  from_user_id     UUID REFERENCES users(id),
  to_user_id       UUID NOT NULL REFERENCES users(id),
  transfer_type    transfer_type NOT NULL,
  settlement_id    UUID REFERENCES settlements(id),
  transferred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ownership_transfers_verification_id ON ownership_transfers(verification_id);
CREATE INDEX IF NOT EXISTS idx_ownership_transfers_to_user_id      ON ownership_transfers(to_user_id);

-- ─── generate_token_name RPC ──────────────────────────────────────────────────
-- Returns username_01, username_02, ... based on existing verification count for user.

CREATE OR REPLACE FUNCTION generate_token_name(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_username TEXT;
  v_count    INTEGER;
BEGIN
  SELECT username INTO v_username FROM users WHERE id = p_user_id;
  IF v_username IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM item_verifications
  WHERE seller_id = p_user_id;

  RETURN v_username || '_' || LPAD((v_count + 1)::TEXT, 2, '0');
END;
$$;

-- ─── updated_at trigger ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_item_verifications_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER trg_item_verifications_updated_at
    BEFORE UPDATE ON item_verifications
    FOR EACH ROW
    EXECUTE FUNCTION update_item_verifications_updated_at();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE item_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE ownership_transfers ENABLE ROW LEVEL SECURITY;

-- Drop and recreate policies so this block is idempotent
DROP POLICY IF EXISTS "public_read_verified_verifications" ON item_verifications;
DROP POLICY IF EXISTS "seller_all_own_verifications"       ON item_verifications;
DROP POLICY IF EXISTS "owner_read_own_verification"        ON item_verifications;
DROP POLICY IF EXISTS "participants_read_transfers"        ON ownership_transfers;
DROP POLICY IF EXISTS "service_insert_transfers"           ON ownership_transfers;

-- Public SELECT for published verifications
-- Cast to text avoids the pg 55P04 "unsafe use of new enum value" error when
-- the enum values were added in the same migration transaction via ADD VALUE.
CREATE POLICY "public_read_verified_verifications"
  ON item_verifications FOR SELECT
  USING (status::text IN ('VERIFIED', 'VIDEO_UPLOADED', 'NFC_PROGRAMMED'));

-- Seller has full access to their own verifications
CREATE POLICY "seller_all_own_verifications"
  ON item_verifications FOR ALL
  USING (seller_id = auth.uid())
  WITH CHECK (seller_id = auth.uid());

-- Current owner can read their item
CREATE POLICY "owner_read_own_verification"
  ON item_verifications FOR SELECT
  USING (current_owner_id = auth.uid());

-- Ownership transfers: anyone involved can read
CREATE POLICY "participants_read_transfers"
  ON ownership_transfers FOR SELECT
  USING (
    from_user_id = auth.uid()
    OR to_user_id = auth.uid()
    OR verification_id IN (
      SELECT id FROM item_verifications WHERE seller_id = auth.uid()
    )
  );

-- Service role inserts transfers (via edge functions / backend)
CREATE POLICY "service_insert_transfers"
  ON ownership_transfers FOR INSERT
  WITH CHECK (TRUE);
