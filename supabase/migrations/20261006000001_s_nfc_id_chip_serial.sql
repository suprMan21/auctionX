-- S-NFC-ID — chip identity = our own per-chip serial (KDF v2)
--
-- 2026-10-05: two physical NTAG 424 chips in one batch reported the same UID
-- (…936980) and both passed NXP originality. UID-only identity and UID-only key
-- diversification assume a uniqueness the supply chain does not guarantee.
-- Decision (Boss, 2026-10-06): from sdm_key_version 2 each chip carries a random
-- 8-byte serial in its SUN URL (?sn=…, covered by every tap's SDMMAC), and its
-- per-chip keys derive from (UID, serial, role, version). chip_001 stays on v1.
--
-- 1. nfc_tags.chip_serial            16 uppercase hex; required at v2+, absent at v1.
--                                     Globally unique: the serial IS the chip's identity.
-- 2. nfc_tags.originality_sig_sha256 SHA-256 of the chip's NXP Read_Sig bytes. Different
--                                     physical chips have different signatures even with
--                                     one UID, so this is the physical fingerprint the
--                                     encoder prechecks against. Unique when present.
-- 3. UID uniqueness moves from (tenant_id, tag_uid) for ALL rows to v1 rows only
--    (chip_serial IS NULL). Existing data is unchanged and stays unique; a v2
--    chip may share a UID with any other chip.
-- 4. Both identity columns are write-once, and a retired chip's are frozen.
--
-- Additive + idempotent. No column is removed, renamed or retyped.

-- ── 1/2. Columns ────────────────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE nfc_tags ADD COLUMN chip_serial TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE nfc_tags ADD COLUMN originality_sig_sha256 TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE nfc_tags
    ADD CONSTRAINT nfc_tags_chip_serial_format_chk CHECK (chip_serial ~ '^[0-9A-F]{16}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE nfc_tags
    ADD CONSTRAINT nfc_tags_originality_sig_format_chk CHECK (originality_sig_sha256 ~ '^[0-9a-f]{64}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- v2+ rows carry a serial; v1 rows never do (their keys take no serial).
DO $$ BEGIN
  ALTER TABLE nfc_tags
    ADD CONSTRAINT nfc_tags_chip_serial_version_chk
    CHECK ((COALESCE(sdm_key_version, 1) >= 2) = (chip_serial IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS nfc_tags_chip_serial_key
  ON nfc_tags (chip_serial) WHERE chip_serial IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS nfc_tags_originality_sig_key
  ON nfc_tags (originality_sig_sha256) WHERE originality_sig_sha256 IS NOT NULL;

COMMENT ON COLUMN nfc_tags.chip_serial IS
  'S-NFC-ID: our per-chip serial (16 uppercase hex) in the SUN URL as ?sn=, covered by the SDMMAC and part of the v2 KDF input. Required iff sdm_key_version >= 2. Not secret.';
COMMENT ON COLUMN nfc_tags.originality_sig_sha256 IS
  'S-NFC-ID: SHA-256 (lowercase hex) of the chip''s NXP originality signature (Read_Sig). Physical-chip fingerprint; distinguishes chips that share a UID.';

-- ── 3. UID unique for v1 rows only ──────────────────────────────────────────
-- Create the replacement first, then drop the table-wide constraint, looked up
-- by its columns rather than an assumed name.

CREATE UNIQUE INDEX IF NOT EXISTS nfc_tags_tenant_uid_v1_key
  ON nfc_tags (tenant_id, tag_uid) WHERE chip_serial IS NULL;

DO $$
DECLARE
  con TEXT;
BEGIN
  SELECT c.conname INTO con
  FROM pg_constraint c
  WHERE c.conrelid = 'public.nfc_tags'::regclass
    AND c.contype = 'u'
    AND (
      SELECT array_agg(a.attname::text ORDER BY a.attname)
      FROM unnest(c.conkey) AS k(attnum)
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    ) = ARRAY['tag_uid', 'tenant_id'];
  IF con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE nfc_tags DROP CONSTRAINT %I', con);
  END IF;
END $$;

-- ── 4. Identity is write-once; retired chips stay frozen ────────────────────

CREATE OR REPLACE FUNCTION nfc_tags_identity_write_once()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (OLD.chip_serial IS NOT NULL AND NEW.chip_serial IS DISTINCT FROM OLD.chip_serial)
     OR (OLD.originality_sig_sha256 IS NOT NULL
         AND NEW.originality_sig_sha256 IS DISTINCT FROM OLD.originality_sig_sha256) THEN
    RAISE EXCEPTION 'tag_identity_immutable: a chip''s serial and fingerprint are write-once'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nfc_tags_identity_write_once ON nfc_tags;
CREATE TRIGGER nfc_tags_identity_write_once
  BEFORE UPDATE ON nfc_tags
  FOR EACH ROW EXECUTE FUNCTION nfc_tags_identity_write_once();

-- Same body as 20261005000002 plus the two identity columns.
CREATE OR REPLACE FUNCTION nfc_tags_freeze_retired()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.lifecycle_status = 'RETIRED' AND (
       NEW.lifecycle_status       IS DISTINCT FROM OLD.lifecycle_status
    OR NEW.current_owner_id       IS DISTINCT FROM OLD.current_owner_id
    OR NEW.item_id                IS DISTINCT FROM OLD.item_id
    OR NEW.linked_item_id         IS DISTINCT FROM OLD.linked_item_id
    OR NEW.sdm_key_version        IS DISTINCT FROM OLD.sdm_key_version
    OR NEW.tag_uid                IS DISTINCT FROM OLD.tag_uid
    OR NEW.chip_serial            IS DISTINCT FROM OLD.chip_serial
    OR NEW.originality_sig_sha256 IS DISTINCT FROM OLD.originality_sig_sha256
    OR NEW.replaced_by_tag_id     IS DISTINCT FROM OLD.replaced_by_tag_id
  ) THEN
    RAISE EXCEPTION 'tag_retired: a retired tag cannot be changed or reused'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
