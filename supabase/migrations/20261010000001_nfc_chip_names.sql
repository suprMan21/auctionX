-- Encoder auto-naming — chip names live in the registry (Locked 2026-10-09)
--
-- Until now a chip's name (`chip_004`) existed only in its SUN URL path and in
-- the encoder's local audit ledger; the backend could not say whether a name
-- was free. Decision (Boss, 2026-10-09): with no name given the encoder uses
-- the next chip_NNN in sequence, and the backend guarantees the name is unique
-- BEFORE any write to the chip.
--
-- 1. nfc_tags.chip_name      the name in the chip's URL path. Optional (legacy
--                             rows), unique ignoring case, write-once.
-- 2. nfc_chip_names           one row per name ever handed out: reserved against
--                             a chip's physical fingerprint before the encoder
--                             writes anything, bound to the tag row at enroll.
--                             Rows are never deleted once bound, so a retired
--                             chip's name is never reused.
-- 3. reserve_chip_name()      atomic: next chip_NNN, or a given name if free.
--                             Idempotent per fingerprint, so re-running a chip
--                             that failed mid-encode gets the same name back.
-- 4. An insert into nfc_tags with a chip_name must match a reservation held by
--    that fingerprint; the same statement binds it.
-- 5. Backfill chip_001..chip_004 (staging; a no-op where those ids are absent).
--
-- Additive + idempotent. No column is removed, renamed or retyped.

-- ── 1. nfc_tags.chip_name ───────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE nfc_tags ADD COLUMN chip_name TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- NULL is allowed on purpose (rows enrolled before names were recorded), so
-- this CHECK is deliberately not wrapped in coalesce.
DO $$ BEGIN
  ALTER TABLE nfc_tags
    ADD CONSTRAINT nfc_tags_chip_name_format_chk CHECK (chip_name ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS nfc_tags_chip_name_key
  ON nfc_tags (lower(chip_name)) WHERE chip_name IS NOT NULL;

COMMENT ON COLUMN nfc_tags.chip_name IS
  'The name in the chip''s SUN URL path (chip_NNN or an operator-given name). Unique ignoring case, write-once. NULL only on rows enrolled before 2026-10-10. Not secret.';

-- ── 2. nfc_chip_names ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nfc_chip_names (
  name        TEXT PRIMARY KEY CHECK (name ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),
  -- NULL only on backfilled v1 rows, which recorded no fingerprint.
  sig_sha256  TEXT CHECK (sig_sha256 ~ '^[0-9a-f]{64}$'),
  tag_id      UUID REFERENCES nfc_tags(id),
  reserved_by UUID,
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  enrolled_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS nfc_chip_names_lower_key ON nfc_chip_names (lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS nfc_chip_names_sig_key ON nfc_chip_names (sig_sha256) WHERE sig_sha256 IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS nfc_chip_names_tag_key ON nfc_chip_names (tag_id) WHERE tag_id IS NOT NULL;

COMMENT ON TABLE nfc_chip_names IS
  'Every chip name ever handed out. Reserved against a chip fingerprint before the encoder writes to the chip; bound to nfc_tags at enroll. Backend (service role) only.';

-- Nothing reads this with a user-level key: no policies, no grants.
ALTER TABLE nfc_chip_names ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON nfc_chip_names FROM PUBLIC, anon, authenticated;

-- ── 3. reserve_chip_name ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reserve_chip_name(
  p_sig_sha256 TEXT,
  p_name       TEXT DEFAULT NULL,
  p_actor      UUID DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  held   nfc_chip_names%ROWTYPE;
  v_name TEXT;
  v_next BIGINT;
BEGIN
  IF coalesce(p_sig_sha256, '') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'chip_name_invalid: fingerprint must be 64 lowercase hex'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_name IS NOT NULL AND p_name !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' THEN
    RAISE EXCEPTION 'chip_name_invalid: letters, digits, _ and - only (1 to 64 chars)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- One reservation at a time: two encoders racing cannot read the same max.
  PERFORM pg_advisory_xact_lock(hashtext('nfc_chip_names'));

  SELECT * INTO held FROM nfc_chip_names WHERE sig_sha256 = p_sig_sha256;
  IF FOUND THEN
    IF held.tag_id IS NOT NULL THEN
      RAISE EXCEPTION 'chip_already_named: this chip is enrolled as %', held.name
        USING ERRCODE = 'unique_violation';
    END IF;
    IF p_name IS NULL OR lower(p_name) = lower(held.name) THEN
      RETURN held.name;  -- a re-run of the same chip keeps its name
    END IF;
    -- The operator re-ran an un-enrolled chip under a different name.
    DELETE FROM nfc_chip_names WHERE name = held.name;
  END IF;

  IF p_name IS NULL THEN
    SELECT coalesce(max(substring(name FROM '^chip_(\d+)$')::BIGINT), 0) + 1
      INTO v_next
      FROM nfc_chip_names
     WHERE name ~ '^chip_\d{1,12}$';
    v_name := 'chip_' || lpad(v_next::TEXT, 3, '0');
  ELSE
    IF EXISTS (SELECT 1 FROM nfc_chip_names WHERE lower(name) = lower(p_name)) THEN
      RAISE EXCEPTION 'chip_name_taken: % is already in use', p_name
        USING ERRCODE = 'unique_violation';
    END IF;
    v_name := p_name;
  END IF;

  INSERT INTO nfc_chip_names (name, sig_sha256, reserved_by) VALUES (v_name, p_sig_sha256, p_actor);
  RETURN v_name;
END;
$$;

REVOKE ALL ON FUNCTION reserve_chip_name(TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reserve_chip_name(TEXT, TEXT, UUID) TO service_role;

-- ── 5. Backfill (before the enroll trigger exists) ──────────────────────────
-- Tag ids from the encoder audit ledger (~/.am-tag-encoder/audit.jsonl).

WITH known(tag_id, name) AS (
  VALUES
    ('253ed5ca-7e89-4b58-b3aa-e129039e1ab9'::UUID, 'chip_001'),
    ('346aee56-b471-4702-926b-88ac932d71b6'::UUID, 'chip_002'),
    ('02a2e02b-89db-44a0-a4be-e9884d076576'::UUID, 'chip_003'),
    ('7c9960df-c768-465c-b41a-1c8aef3e5c23'::UUID, 'chip_004')
)
INSERT INTO nfc_chip_names (name, sig_sha256, tag_id, reserved_at, enrolled_at)
SELECT k.name, t.originality_sig_sha256, t.id, t.registered_at, t.registered_at
  FROM known k
  JOIN nfc_tags t ON t.id = k.tag_id
ON CONFLICT DO NOTHING;

UPDATE nfc_tags t
   SET chip_name = n.name
  FROM nfc_chip_names n
 WHERE n.tag_id = t.id
   AND t.chip_name IS NULL;

-- ── 4. Enroll binds the reservation; the name is write-once ─────────────────

CREATE OR REPLACE FUNCTION nfc_tags_bind_chip_name()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.chip_name IS NULL THEN
    RETURN NEW;
  END IF;
  UPDATE nfc_chip_names
     SET tag_id = NEW.id, enrolled_at = now()
   WHERE lower(name) = lower(NEW.chip_name)
     AND tag_id IS NULL
     AND sig_sha256 IS NOT NULL
     AND sig_sha256 = NEW.originality_sig_sha256;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'chip_name_not_reserved: % is not reserved for this chip', NEW.chip_name
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nfc_tags_bind_chip_name ON nfc_tags;
CREATE TRIGGER nfc_tags_bind_chip_name
  AFTER INSERT ON nfc_tags
  FOR EACH ROW EXECUTE FUNCTION nfc_tags_bind_chip_name();

-- Same body as 20261006000001 plus chip_name.
CREATE OR REPLACE FUNCTION nfc_tags_identity_write_once()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (OLD.chip_serial IS NOT NULL AND NEW.chip_serial IS DISTINCT FROM OLD.chip_serial)
     OR (OLD.originality_sig_sha256 IS NOT NULL
         AND NEW.originality_sig_sha256 IS DISTINCT FROM OLD.originality_sig_sha256)
     OR (OLD.chip_name IS NOT NULL AND NEW.chip_name IS DISTINCT FROM OLD.chip_name) THEN
    RAISE EXCEPTION 'tag_identity_immutable: a chip''s serial, fingerprint and name are write-once'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
