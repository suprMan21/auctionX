-- S-SEAL1 Ph1 — nfc_tags.seal_code (Decision Locked 2026-10-26)
--
-- A short random public code for each seal, shown as XXXX-XXXX on the tap page,
-- in My Seals and (later) on the animated / shared seal. It IDENTIFIES a seal;
-- it never authenticates one (only a tap does).
--
-- Format: 8 Crockford base32 characters (0-9, A-Z without I, L, O, U), stored
-- without the hyphen. Random, never derived from key material, never reused,
-- write-once. Reserved with the chip name before any chip write, so the
-- encoding station learns the code in the same step.
--
-- 1. nfc_tags.seal_code + nfc_chip_names.seal_code (optional, unique).
-- 2. gen_seal_code()            8 random characters (service_role only).
-- 3. reserve_chip_identity()    reserve_chip_name() + the reservation's seal
--                               code. reserve_chip_name() is unchanged, so the
--                               backend still deployed keeps working.
-- 4. nfc_tags BEFORE INSERT     a new tag takes its reserved code, or a fresh one.
-- 5. Write-once                 seal_code joins serial / fingerprint / name.
-- 6. Backfill                   every tag without a code, retired ones too.
--
-- Additive + idempotent. No column is removed, renamed or retyped.

-- ── 1. Columns ──────────────────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE nfc_tags ADD COLUMN seal_code TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE nfc_tags
    ADD CONSTRAINT nfc_tags_seal_code_format_chk CHECK (seal_code ~ '^[0-9A-HJKMNP-TV-Z]{8}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS nfc_tags_seal_code_key
  ON nfc_tags (seal_code) WHERE seal_code IS NOT NULL;

COMMENT ON COLUMN nfc_tags.seal_code IS
  'Public seal code (8 Crockford base32 chars, shown XXXX-XXXX). Random, unique, write-once, never derived from key material. Identifies a seal, never authenticates it. Not secret, but served only through the backend.';

DO $$ BEGIN
  ALTER TABLE nfc_chip_names ADD COLUMN seal_code TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE nfc_chip_names
    ADD CONSTRAINT nfc_chip_names_seal_code_format_chk CHECK (seal_code ~ '^[0-9A-HJKMNP-TV-Z]{8}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS nfc_chip_names_seal_code_key
  ON nfc_chip_names (seal_code) WHERE seal_code IS NOT NULL;

-- ── 2. gen_seal_code ────────────────────────────────────────────────────────

-- 256 is a multiple of 32, so (byte & 31) is uniform over the alphabet.
CREATE OR REPLACE FUNCTION gen_seal_code()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SET search_path = public, extensions
AS $$
DECLARE
  alphabet CONSTANT TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  bytes    BYTEA := extensions.gen_random_bytes(8);
  code     TEXT := '';
BEGIN
  FOR i IN 0..7 LOOP
    code := code || substr(alphabet, (get_byte(bytes, i) & 31) + 1, 1);
  END LOOP;
  RETURN code;
END;
$$;

REVOKE ALL ON FUNCTION gen_seal_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION gen_seal_code() TO service_role;

-- A code no tag and no reservation holds. 32^8 ≈ 1.1e12, so a retry is rare;
-- the cap only stops an endless loop if something is badly wrong.
CREATE OR REPLACE FUNCTION new_unused_seal_code()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_code TEXT;
BEGIN
  FOR attempt IN 1..20 LOOP
    v_code := gen_seal_code();
    IF NOT EXISTS (SELECT 1 FROM nfc_tags WHERE seal_code = v_code)
       AND NOT EXISTS (SELECT 1 FROM nfc_chip_names WHERE seal_code = v_code) THEN
      RETURN v_code;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'seal_code_exhausted: no free seal code after 20 tries';
END;
$$;

REVOKE ALL ON FUNCTION new_unused_seal_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION new_unused_seal_code() TO service_role;

-- ── 3. reserve_chip_identity ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reserve_chip_identity(
  p_sig_sha256 TEXT,
  p_name       TEXT DEFAULT NULL,
  p_actor      UUID DEFAULT NULL
)
RETURNS TABLE (name TEXT, seal_code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_name TEXT;
  v_code TEXT;
BEGIN
  -- Same rules, lock and errors as before (chip_name_taken, chip_already_named, …).
  v_name := reserve_chip_name(p_sig_sha256, p_name, p_actor);

  -- Still under reserve_chip_name's transaction lock, so no other reservation races this.
  SELECT n.seal_code INTO v_code FROM nfc_chip_names n WHERE n.name = v_name;
  IF v_code IS NULL THEN
    v_code := new_unused_seal_code();
    UPDATE nfc_chip_names n SET seal_code = v_code WHERE n.name = v_name;
  END IF;

  name := v_name;
  seal_code := v_code;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION reserve_chip_identity(TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reserve_chip_identity(TEXT, TEXT, UUID) TO service_role;

-- ── 4. A new tag gets its seal code ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION nfc_tags_assign_seal_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.seal_code IS NOT NULL THEN
    RETURN NEW;  -- the CHECK and the unique index still apply
  END IF;
  IF NEW.chip_name IS NOT NULL AND NEW.originality_sig_sha256 IS NOT NULL THEN
    -- The code the encoding station was given when the name was reserved.
    -- (The AFTER INSERT bind trigger still refuses a name not reserved for this chip.)
    SELECT n.seal_code INTO NEW.seal_code
      FROM nfc_chip_names n
     WHERE lower(n.name) = lower(NEW.chip_name)
       AND n.tag_id IS NULL
       AND n.sig_sha256 = NEW.originality_sig_sha256;
  END IF;
  IF NEW.seal_code IS NULL THEN
    NEW.seal_code := new_unused_seal_code();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION nfc_tags_assign_seal_code() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS nfc_tags_assign_seal_code ON nfc_tags;
CREATE TRIGGER nfc_tags_assign_seal_code
  BEFORE INSERT ON nfc_tags
  FOR EACH ROW EXECUTE FUNCTION nfc_tags_assign_seal_code();

-- ── 5. Write-once (same body as 20261010000001 plus seal_code) ──────────────

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
     OR (OLD.seal_code IS NOT NULL AND NEW.seal_code IS DISTINCT FROM OLD.seal_code) THEN
    RAISE EXCEPTION 'tag_identity_immutable: a chip''s serial, fingerprint, name and seal code are write-once'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- A reservation's code is write-once too once it is set.
CREATE OR REPLACE FUNCTION nfc_chip_names_seal_code_write_once()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.seal_code IS NOT NULL AND NEW.seal_code IS DISTINCT FROM OLD.seal_code THEN
    RAISE EXCEPTION 'seal_code_immutable: a reserved seal code is write-once'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nfc_chip_names_seal_code_write_once ON nfc_chip_names;
CREATE TRIGGER nfc_chip_names_seal_code_write_once
  BEFORE UPDATE ON nfc_chip_names
  FOR EACH ROW EXECUTE FUNCTION nfc_chip_names_seal_code_write_once();

-- ── 6. Backfill ─────────────────────────────────────────────────────────────
-- Every tag without a code (chip_001, chip_004, chip_, retired chip_002/003 …).
-- The retired-freeze trigger does not cover seal_code, so history stays readable.

DO $$
DECLARE
  r RECORD;
  v_code TEXT;
BEGIN
  FOR r IN SELECT t.id, n.seal_code AS reserved
             FROM nfc_tags t
             LEFT JOIN nfc_chip_names n ON n.tag_id = t.id
            WHERE t.seal_code IS NULL
            ORDER BY t.registered_at NULLS LAST, t.id
  LOOP
    v_code := coalesce(r.reserved, new_unused_seal_code());
    UPDATE nfc_tags SET seal_code = v_code WHERE id = r.id;
  END LOOP;

  -- Bound reservations carry the same code as their tag.
  UPDATE nfc_chip_names n
     SET seal_code = t.seal_code
    FROM nfc_tags t
   WHERE n.tag_id = t.id
     AND n.seal_code IS NULL;
END $$;
