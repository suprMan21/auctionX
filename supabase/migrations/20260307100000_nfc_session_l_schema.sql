-- Session L: NFC Verification Schema
-- Adds nfc_tags, verification_events, nft_metadata tables
-- Extends ownership_transfers with optional columns
-- Fully idempotent: safe to run multiple times

-- =============================================================
-- 1. nfc_tags — registered NTAG 424 DNA chips
-- =============================================================
CREATE TABLE IF NOT EXISTS nfc_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL DEFAULT 'auctionx',
  tag_uid TEXT NOT NULL,
  item_id UUID REFERENCES listings(id) ON DELETE SET NULL,
  seller_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  verification_id UUID REFERENCES item_verifications(id) ON DELETE SET NULL,
  aes_key_enc TEXT NOT NULL,
  sun_counter INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'registered',
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, tag_uid)
);

CREATE INDEX IF NOT EXISTS idx_nfc_tags_seller ON nfc_tags(seller_id);
CREATE INDEX IF NOT EXISTS idx_nfc_tags_item ON nfc_tags(item_id);
CREATE INDEX IF NOT EXISTS idx_nfc_tags_tenant ON nfc_tags(tenant_id);
CREATE INDEX IF NOT EXISTS idx_nfc_tags_tag_uid ON nfc_tags(tag_uid);

-- updated_at trigger
DO $$ BEGIN
  CREATE TRIGGER set_nfc_tags_updated_at
    BEFORE UPDATE ON nfc_tags
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS
ALTER TABLE nfc_tags ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "nfc_tags_public_read" ON nfc_tags
    FOR SELECT USING (status IN ('registered', 'active'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "nfc_tags_seller_insert" ON nfc_tags
    FOR INSERT WITH CHECK (auth.uid() = seller_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "nfc_tags_seller_update" ON nfc_tags
    FOR UPDATE USING (auth.uid() = seller_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "nfc_tags_seller_delete" ON nfc_tags
    FOR DELETE USING (auth.uid() = seller_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================
-- 2. verification_events — NFC scan / verification log
-- =============================================================
CREATE TABLE IF NOT EXISTS verification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_id UUID NOT NULL REFERENCES nfc_tags(id) ON DELETE CASCADE,
  scan_type TEXT NOT NULL DEFAULT 'verification',
  scanned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  video_proof_url TEXT,
  video_proof_status TEXT,
  blockchain_tx_hash TEXT,
  sun_message TEXT,
  sun_counter_value INTEGER,
  cmac_valid BOOLEAN,
  ip_address INET,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verification_events_tag ON verification_events(tag_id);
CREATE INDEX IF NOT EXISTS idx_verification_events_created ON verification_events(created_at DESC);

-- RLS
ALTER TABLE verification_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "verification_events_public_read" ON verification_events
    FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "verification_events_authenticated_insert" ON verification_events
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================
-- 3. nft_metadata — on-chain NFT data for verified items
-- =============================================================
CREATE TABLE IF NOT EXISTS nft_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_id UUID NOT NULL REFERENCES nfc_tags(id) ON DELETE CASCADE,
  chain TEXT NOT NULL DEFAULT 'base',
  contract_address TEXT,
  token_id TEXT,
  mint_tx_hash TEXT,
  metadata_uri TEXT,
  metadata_json JSONB DEFAULT '{}'::jsonb,
  owner_wallet TEXT,
  minted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nft_metadata_tag ON nft_metadata(tag_id);
CREATE INDEX IF NOT EXISTS idx_nft_metadata_contract_token ON nft_metadata(contract_address, token_id);

-- updated_at trigger
DO $$ BEGIN
  CREATE TRIGGER set_nft_metadata_updated_at
    BEFORE UPDATE ON nft_metadata
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS
ALTER TABLE nft_metadata ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "nft_metadata_public_read" ON nft_metadata
    FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================
-- 4. Extend ownership_transfers with optional columns
-- =============================================================
DO $$ BEGIN
  ALTER TABLE ownership_transfers ADD COLUMN tag_id UUID REFERENCES nfc_tags(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ownership_transfers ADD COLUMN transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ownership_transfers ADD COLUMN verification_event_id UUID REFERENCES verification_events(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ownership_transfers ADD COLUMN status TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ownership_transfers ADD COLUMN completed_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
