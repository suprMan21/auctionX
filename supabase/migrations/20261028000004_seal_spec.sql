-- S-SEAL1 Ph2a — nfc_tags.seal_spec (pattern v1 Locked 2026-10-28)
--
-- The seal spec is one small JSON per seal: { v, code, colors, pattern }.
-- The backend builds it from the seal code (lib/seal/sealSpec.ts) and stores it
-- the first time the seal is read, at enroll, and by the backfill script.
-- The website, the server images and later the app all draw from it.
--
-- The pattern is decoration seeded from the public seal code. It is not a
-- security feature: only a tap proves a seal.
--
-- 1. nfc_tags.seal_spec JSONB            optional; must be an object with v + code,
--                                        and its code must be the tag's seal code.
-- 2. nfc_tags.seal_design_version_id     optional; no FK until S-SEAL2 adds the table.
-- 3. Write-once                          seal_spec joins serial / fingerprint / name / code.
--                                        The retired-freeze trigger does not list it, so a
--                                        retired seal can still be given its spec once.
--
-- No grants change. Additive + idempotent. No column is removed, renamed or retyped.

-- ── 1. + 2. Columns ─────────────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE nfc_tags ADD COLUMN seal_spec JSONB;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE nfc_tags
    ADD CONSTRAINT nfc_tags_seal_spec_shape_chk CHECK (
      seal_spec IS NULL OR (
        jsonb_typeof(seal_spec) = 'object'
        AND seal_spec ? 'v'
        AND seal_spec ? 'code'
        AND seal_spec ->> 'code' IS NOT DISTINCT FROM seal_code
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN nfc_tags.seal_spec IS
  'S-SEAL1 seal spec (v, code, colors, pattern). Built by the backend from seal_code, write-once. Decoration only; never authenticates. Served only through the backend.';

DO $$ BEGIN
  ALTER TABLE nfc_tags ADD COLUMN seal_design_version_id UUID;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

COMMENT ON COLUMN nfc_tags.seal_design_version_id IS
  'S-SEAL2 creator seal design version. No FK until that table exists. Unused in Ph2.';

-- ── 3. Write-once (same body as 20261028000003 plus seal_spec) ──────────────

CREATE OR REPLACE FUNCTION nfc_tags_identity_write_once()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (OLD.chip_serial IS NOT NULL AND NEW.chip_serial IS DISTINCT FROM OLD.chip_serial)
     OR (OLD.originality_sig_sha256 IS NOT NULL
         AND NEW.originality_sig_sha256 IS DISTINCT FROM OLD.originality_sig_sha256)
     OR (OLD.chip_name IS NOT NULL AND NEW.chip_name IS DISTINCT FROM OLD.chip_name)
     OR (OLD.seal_code IS NOT NULL AND NEW.seal_code IS DISTINCT FROM OLD.seal_code)
     OR (OLD.seal_spec IS NOT NULL AND NEW.seal_spec IS DISTINCT FROM OLD.seal_spec) THEN
    RAISE EXCEPTION 'tag_identity_immutable: a chip''s serial, fingerprint, name, seal code and seal spec are write-once'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
