-- =============================================================================
-- S-ANCHOR1 Ph1 hardening (security review of 20261027000004)
-- =============================================================================
-- 1. anchor_batches.sent_tx_hashes: every tx hash we ever signed for a batch.
--    Reconciliation now matches an on-chain write on (value AND tx hash), so a
--    stolen writer key replaying a known root still alerts.
-- 2. anchor_alerts kind 'owner_changed': OwnershipTransferStarted /
--    OwnershipTransferred on the registry.
-- Optional column + widened CHECK only; nothing renamed or removed.
-- =============================================================================

ALTER TABLE anchor_batches
  ADD COLUMN IF NOT EXISTS sent_tx_hashes TEXT[] NOT NULL DEFAULT '{}';

-- Keep it consistent with tx_hash for any row written before this column existed.
UPDATE anchor_batches
   SET sent_tx_hashes = ARRAY[tx_hash]
 WHERE tx_hash IS NOT NULL AND NOT (tx_hash = ANY (sent_tx_hashes));

DO $$ BEGIN
  ALTER TABLE anchor_batches ADD CONSTRAINT anchor_batches_sent_tx_chk
    CHECK (tx_hash IS NULL OR tx_hash = ANY (sent_tx_hashes));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE anchor_alerts DROP CONSTRAINT IF EXISTS anchor_alerts_kind_chk;
ALTER TABLE anchor_alerts ADD CONSTRAINT anchor_alerts_kind_chk CHECK (coalesce(kind, '') IN (
  'unmatched_event',  -- a registry write with no matching batch AND tx we signed: forged-write detection
  'writer_changed',   -- WriterChanged to an address that is not our KMS writer
  'writer_mismatch',  -- the registry's writer is not our KMS key, so sends are paused
  'owner_changed',    -- registry ownership transfer started or completed
  'low_balance',
  'anchor_failing',
  'anchor_reverted',
  'anchor_stuck'
));
