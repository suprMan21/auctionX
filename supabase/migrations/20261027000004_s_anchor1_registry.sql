-- =============================================================================
-- S-ANCHOR1 Ph1 — Ownership Registry anchoring (Base Sepolia only)
-- =============================================================================
-- Publishes Ownership IDs to the OwnershipRegistry contract. NOT an NFT:
-- nothing on-chain is ownable or tradeable, and only 32-byte fingerprints are
-- written (an Ownership ID, or one day's Merkle root).
--
-- Launch mode is daily_batch (Decisions DB, Locked 2026-10-27): one Merkle root
-- per UTC day, published every day even when empty, with a random padding leaf
-- so quiet days and single-event days look the same on-chain. per_event mode is
-- a batch of one whose root IS the Ownership ID.
--
--   1. anchor_batches         one row per root (or per Ownership ID in per_event)
--   2. ownership_proofs       + anchor_batch_id, merkle_proof (optional columns)
--   3. anchor_chain_state     reconciliation scan cursor per registry
--   4. anchor_alerts          deduplicated alerts (one GitHub Issue each)
--   5. record_anchor_batch / confirm_anchor_batch / record_anchor_alert
--   6. RLS + grants: service_role only, nothing for anon or authenticated
--   7. anchor-tick: pg_cron, hourly
--
-- Schema rules: optional columns only on existing tables; nothing renamed.
-- =============================================================================

-- ── 1. anchor_batches ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS anchor_batches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode             TEXT NOT NULL,
  -- daily_batch: the UTC day this root closes. NULL for per_event.
  batch_day        DATE,
  -- Every unbatched proof created before this instant went into the root.
  cutoff_at        TIMESTAMPTZ NOT NULL,
  merkle_root      TEXT NOT NULL,
  -- daily_batch only: one random bytes32 leaf. Never shown to anyone; kept so
  -- the root can be recomputed from the database during reconciliation.
  padding_leaf     TEXT,
  -- Real Ownership IDs in the root (the padding leaf is not counted).
  leaf_count       INTEGER NOT NULL,
  chain_id         INTEGER NOT NULL,
  registry_address TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',
  tx_hash          TEXT,
  tx_nonce         BIGINT,
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error       TEXT,
  submitted_at     TIMESTAMPTZ,
  block_number     BIGINT,
  -- Block time of the confirming block, not the time we noticed.
  anchored_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT anchor_batches_mode_chk   CHECK (coalesce(mode, '') IN ('daily_batch', 'per_event')),
  CONSTRAINT anchor_batches_status_chk CHECK (coalesce(status, '') IN ('pending', 'submitted', 'confirmed')),
  CONSTRAINT anchor_batches_root_chk   CHECK (merkle_root ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT anchor_batches_pad_chk    CHECK (padding_leaf IS NULL OR padding_leaf ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT anchor_batches_reg_chk    CHECK (registry_address ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT anchor_batches_tx_chk     CHECK (tx_hash IS NULL OR tx_hash ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT anchor_batches_count_chk  CHECK (leaf_count >= 0),
  -- A daily root has a day and a padding leaf; a per_event root has neither and
  -- holds exactly one Ownership ID.
  CONSTRAINT anchor_batches_shape_chk CHECK (
    (mode = 'daily_batch' AND batch_day IS NOT NULL AND padding_leaf IS NOT NULL)
    OR (mode = 'per_event' AND batch_day IS NULL AND padding_leaf IS NULL AND leaf_count = 1)
  ),
  CONSTRAINT anchor_batches_submitted_chk CHECK (
    status = 'pending' OR (tx_hash IS NOT NULL AND tx_nonce IS NOT NULL AND submitted_at IS NOT NULL)
  ),
  CONSTRAINT anchor_batches_confirmed_chk CHECK (
    status <> 'confirmed' OR (block_number IS NOT NULL AND anchored_at IS NOT NULL)
  )
);

-- One daily root per day per registry: a second tick for the same day is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS idx_anchor_batches_one_per_day
  ON anchor_batches (chain_id, registry_address, batch_day)
  WHERE mode = 'daily_batch';

CREATE INDEX IF NOT EXISTS idx_anchor_batches_open
  ON anchor_batches (status, next_attempt_at)
  WHERE status <> 'confirmed';

-- Reconciliation looks events up by the value written.
CREATE INDEX IF NOT EXISTS idx_anchor_batches_root
  ON anchor_batches (chain_id, registry_address, merkle_root);

-- ── 2. ownership_proofs: batch membership ───────────────────────────────────
ALTER TABLE ownership_proofs
  ADD COLUMN IF NOT EXISTS anchor_batch_id UUID REFERENCES anchor_batches(id) ON DELETE RESTRICT;
-- JSON array of bytes32 hex strings: this proof's path to the root. '[]' in
-- per_event mode (the root is the Ownership ID itself).
ALTER TABLE ownership_proofs
  ADD COLUMN IF NOT EXISTS merkle_proof JSONB;

DO $$ BEGIN
  ALTER TABLE ownership_proofs ADD CONSTRAINT ownership_proofs_merkle_proof_chk
    CHECK (merkle_proof IS NULL OR jsonb_typeof(merkle_proof) = 'array');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE ownership_proofs ADD CONSTRAINT ownership_proofs_batch_pair_chk
    CHECK ((anchor_batch_id IS NULL) = (merkle_proof IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_ownership_proofs_anchor_batch
  ON ownership_proofs (anchor_batch_id);
CREATE INDEX IF NOT EXISTS idx_ownership_proofs_unbatched
  ON ownership_proofs (created_at)
  WHERE anchor_batch_id IS NULL;

-- ── 3. anchor_chain_state ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS anchor_chain_state (
  chain_id           INTEGER NOT NULL,
  registry_address   TEXT NOT NULL,
  last_scanned_block BIGINT NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, registry_address),
  CONSTRAINT anchor_chain_state_reg_chk CHECK (registry_address ~ '^0x[0-9a-f]{40}$')
);

-- ── 4. anchor_alerts ────────────────────────────────────────────────────────
-- IDs, hashes and numbers only: never an email, a UID or user text.
CREATE TABLE IF NOT EXISTS anchor_alerts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                TEXT NOT NULL,
  dedupe_key          TEXT NOT NULL UNIQUE,
  detail              JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  seen_count          INTEGER NOT NULL DEFAULT 1,
  github_issue_number INTEGER,
  github_issue_url    TEXT,
  resolved_at         TIMESTAMPTZ,
  CONSTRAINT anchor_alerts_kind_chk CHECK (coalesce(kind, '') IN (
    'unmatched_event',  -- a registry write with no matching batch: forged-write detection
    'writer_changed',   -- WriterChanged to an address that is not our KMS writer
    'writer_mismatch',  -- the registry's writer is not our KMS key, so sends are paused
    'low_balance',      -- the writer wallet is below the float
    'anchor_failing',   -- a batch keeps failing to send
    'anchor_reverted',  -- a sent batch reverted on-chain
    'anchor_stuck'      -- a sent batch has not been mined for a long time
  )),
  CONSTRAINT anchor_alerts_detail_chk CHECK (jsonb_typeof(detail) = 'object')
);

-- ── 5. Functions ────────────────────────────────────────────────────────────

-- Creates a batch and assigns its proofs in ONE transaction. If any proof was
-- already batched (a concurrent tick), nothing is written. A daily batch that
-- already exists for the day is returned as-is (created = false).
CREATE OR REPLACE FUNCTION record_anchor_batch(
  p_mode             TEXT,
  p_batch_day        DATE,
  p_cutoff_at        TIMESTAMPTZ,
  p_merkle_root      TEXT,
  p_padding_leaf     TEXT,
  p_chain_id         INTEGER,
  p_registry_address TEXT,
  p_leaves           JSONB  -- [{ "proof_id": uuid, "ownership_id": "0x..", "merkle_proof": ["0x..", ...] }]
)
RETURNS TABLE (batch_id UUID, created BOOLEAN)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id       UUID;
  v_expected INTEGER;
  v_updated  INTEGER;
BEGIN
  IF jsonb_typeof(p_leaves) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'anchor_leaves_invalid';
  END IF;
  v_expected := jsonb_array_length(p_leaves);

  IF p_mode = 'daily_batch' THEN
    SELECT b.id INTO v_id FROM anchor_batches b
     WHERE b.mode = 'daily_batch' AND b.chain_id = p_chain_id
       AND b.registry_address = p_registry_address AND b.batch_day = p_batch_day;
    IF v_id IS NOT NULL THEN
      RETURN QUERY SELECT v_id, false;
      RETURN;
    END IF;
  END IF;

  INSERT INTO anchor_batches (mode, batch_day, cutoff_at, merkle_root, padding_leaf,
                              leaf_count, chain_id, registry_address)
  VALUES (p_mode, p_batch_day, p_cutoff_at, p_merkle_root, p_padding_leaf,
          v_expected, p_chain_id, p_registry_address)
  RETURNING id INTO v_id;

  -- The ownership_id must match too, so a leaf can never be filed against the
  -- wrong proof row.
  UPDATE ownership_proofs op
     SET anchor_batch_id = v_id,
         merkle_proof    = l.value -> 'merkle_proof'
    FROM jsonb_array_elements(p_leaves) l
   WHERE op.id = (l.value ->> 'proof_id')::uuid
     AND op.ownership_id = l.value ->> 'ownership_id'
     AND op.created_at < p_cutoff_at
     AND op.anchor_batch_id IS NULL
     AND jsonb_typeof(l.value -> 'merkle_proof') = 'array';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated <> v_expected THEN
    RAISE EXCEPTION 'anchor_batch_conflict' USING DETAIL = format('%s of %s', v_updated, v_expected);
  END IF;

  RETURN QUERY SELECT v_id, true;
END;
$$;

-- Marks a submitted batch confirmed and stamps its proofs, in one transaction.
-- Only the tx the batch is bound to can confirm it.
CREATE OR REPLACE FUNCTION confirm_anchor_batch(
  p_batch_id     UUID,
  p_tx_hash      TEXT,
  p_block_number BIGINT,
  p_anchored_at  TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  UPDATE anchor_batches
     SET status = 'confirmed', block_number = p_block_number,
         anchored_at = p_anchored_at, last_error = NULL
   WHERE id = p_batch_id AND status = 'submitted' AND tx_hash = p_tx_hash;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN false;
  END IF;

  UPDATE ownership_proofs
     SET anchored_tx_hash = p_tx_hash, anchored_at = p_anchored_at
   WHERE anchor_batch_id = p_batch_id;

  RETURN true;
END;
$$;

-- Upserts an alert by dedupe key. is_new tells the caller to open an issue.
CREATE OR REPLACE FUNCTION record_anchor_alert(
  p_kind       TEXT,
  p_dedupe_key TEXT,
  p_detail     JSONB
)
RETURNS TABLE (alert_id UUID, is_new BOOLEAN, github_issue_number INTEGER)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO anchor_alerts AS a (kind, dedupe_key, detail)
  VALUES (p_kind, p_dedupe_key, coalesce(p_detail, '{}'::jsonb))
  ON CONFLICT (dedupe_key) DO UPDATE
     SET last_seen_at = now(), seen_count = a.seen_count + 1
  RETURNING a.id, (a.seen_count = 1), a.github_issue_number;
END;
$$;

-- ── 6. RLS + grants ─────────────────────────────────────────────────────────
-- Backend only (service role). No policies: anon and authenticated see nothing.
ALTER TABLE anchor_batches     ENABLE ROW LEVEL SECURITY;
ALTER TABLE anchor_chain_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE anchor_alerts      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON anchor_batches, anchor_chain_state, anchor_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON anchor_batches, anchor_chain_state, anchor_alerts TO service_role;

REVOKE EXECUTE ON FUNCTION record_anchor_batch(TEXT, DATE, TIMESTAMPTZ, TEXT, TEXT, INTEGER, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION confirm_anchor_batch(UUID, TEXT, BIGINT, TIMESTAMPTZ)                         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION record_anchor_alert(TEXT, TEXT, JSONB)                                         FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION record_anchor_batch(TEXT, DATE, TIMESTAMPTZ, TEXT, TEXT, INTEGER, TEXT, JSONB) TO service_role;
GRANT  EXECUTE ON FUNCTION confirm_anchor_batch(UUID, TEXT, BIGINT, TIMESTAMPTZ)                         TO service_role;
GRANT  EXECUTE ON FUNCTION record_anchor_alert(TEXT, TEXT, JSONB)                                         TO service_role;

-- ── 7. anchor-tick: hourly ──────────────────────────────────────────────────
-- pg_cron -> pg_net -> POST <backend>/api/v1/internal/anchor-tick with a shared
-- secret. The backend (not the database) talks to KMS and the chain.
-- Until BOTH Vault secrets exist the tick sends nothing:
--   backend_api_url   (already set for the fee sweep)
--   SELECT vault.create_secret('<same value as ANCHOR_TICK_SECRET>', 'anchor_tick_secret');
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'anchor-tick') THEN
    PERFORM cron.unschedule('anchor-tick');
  END IF;

  PERFORM cron.schedule(
    'anchor-tick',
    '7 * * * *',
    $cron$
      SELECT net.http_post(
        url := b.decrypted_secret || '/api/v1/internal/anchor-tick',
        headers := jsonb_build_object(
          'Content-Type',   'application/json',
          'x-anchor-secret', s.decrypted_secret
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      ) AS request_id
      FROM vault.decrypted_secrets b, vault.decrypted_secrets s
      WHERE b.name = 'backend_api_url' AND s.name = 'anchor_tick_secret';
    $cron$
  );
EXCEPTION
  WHEN undefined_table OR invalid_schema_name OR undefined_function THEN
    RAISE NOTICE 'pg_cron not present: anchor-tick not scheduled';
END $$;
