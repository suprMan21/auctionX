-- S-NFC3.5 — Real AN12196 SDM crypto realignment
--
-- 1. nfc_tags.sdm_key_version: which version of the fleet-wide SDMMetaReadKey
--    (and of the per-UID SDMFileReadKey) a chip was personalised with. Lets a
--    rotated META key keep serving chips encoded under an older version.
--    Key material itself is NEVER stored: keys are derived on demand from the
--    SDM KMS HMAC root (alias/am-tag-sdm-staging on staging) and held only in memory.
--
-- 2. nfc_tags.aes_key_enc: relax NOT NULL. Since S-NFC3.5 nothing reads or
--    writes this column (keys are derived, not stored). Existing values are
--    deliberately LEFT UNTOUCHED — nulling them is a separate decision for
--    Boss. Relaxing NOT NULL -> nullable does not retype the column
--    (precedent: 20260622000000 §4c).
--
-- Additive + idempotent: safe to run more than once.

DO $$ BEGIN
  ALTER TABLE nfc_tags ADD COLUMN sdm_key_version SMALLINT DEFAULT 1;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE nfc_tags
    ADD CONSTRAINT nfc_tags_sdm_key_version_chk CHECK (sdm_key_version BETWEEN 1 AND 255);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN nfc_tags.sdm_key_version IS
  'S-NFC3.5: version of the SDMMetaReadKey/SDMFileReadKey this chip was encoded with (KDF version byte). No key material is stored.';

-- DROP NOT NULL is natively idempotent; no exception wrapper, so a real
-- failure (e.g. missing table) surfaces instead of being swallowed.
ALTER TABLE nfc_tags ALTER COLUMN aes_key_enc DROP NOT NULL;

COMMENT ON COLUMN nfc_tags.aes_key_enc IS
  'DEPRECATED (S-NFC3.5): never read or written. Historically held a plaintext hex AES key despite the name. Existing values retained pending a Boss decision.';
