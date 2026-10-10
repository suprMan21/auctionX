-- Encoder auto-naming — the chip_ prefix is reserved for the sequence
--
-- 2026-10-10: the first chip encoded after auto-naming shipped was given the
-- manual name `chip_` (a name was passed on the command line), which the
-- format check allowed. From now on a manual name that starts with `chip_`
-- (any case) is refused unless it is exactly the name the sequence would hand
-- out next. Any other manual name works as before. The existing `chip_` row is
-- untouched: it does not match chip_<digits>, so it never affects the sequence.
--
-- Same function as 20261010000001 plus that one check. A re-run of a chip
-- that already holds a name still gets it back before the check runs.

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
  v_auto TEXT;
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

  SELECT coalesce(max(substring(name FROM '^chip_(\d+)$')::BIGINT), 0) + 1
    INTO v_next
    FROM nfc_chip_names
   WHERE name ~ '^chip_\d{1,12}$';
  v_auto := 'chip_' || lpad(v_next::TEXT, 3, '0');

  IF p_name IS NULL THEN
    v_name := v_auto;
  ELSE
    -- The chip_ prefix belongs to the sequence: a typo must not create `chip_`
    -- or `chip_5`, and a hand-picked chip_040 must not make the sequence jump.
    IF lower(p_name) LIKE 'chip\_%' AND p_name <> v_auto THEN
      RAISE EXCEPTION 'chip_name_reserved: names starting with chip_ are assigned in sequence (next is %)', v_auto
        USING ERRCODE = 'check_violation';
    END IF;
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
