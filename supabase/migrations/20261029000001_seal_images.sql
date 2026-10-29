-- S-SEAL1 Ph2b — seal images (preview + share) kept in S3, and the tick that keeps them in step
--
-- 1. nfc_tags.seal_images_at TIMESTAMPTZ   optional; when this seal's preview image was last stored in S3.
--                                          NULL = no image stored (never drawn, or removed).
-- 2. pg_cron 'seal-images-tick' every 10 min → POST <backend>/api/v1/internal/seal-images
--    The backend draws images for live seals (ENROLLED / ACTIVE) that have none and removes them for
--    seals on hold, released or retired. Additive and idempotent. Same Vault pattern as the fee sweep:
--      SELECT vault.create_secret('<same value as SEAL_IMAGES_TICK_SECRET>', 'seal_images_tick_secret');
--    (`backend_api_url` already exists.) Until the secret exists the tick sends nothing.
--
-- Retired tags: nfc_tags_freeze_retired only guards lifecycle / owner / item / key / UID / replacement,
-- so clearing seal_images_at on a retired tag is allowed. No grants change: anon still reads no row.

DO $$ BEGIN
  ALTER TABLE nfc_tags ADD COLUMN seal_images_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

COMMENT ON COLUMN nfc_tags.seal_images_at IS
  'S-SEAL1 Ph2b: when the seal''s preview image was stored in S3 (seal-img/<code>/preview-v1.png). '
  'NULL = none stored. Set and cleared only by the backend (service role).';

-- Partial indexes for the two halves of the tick.
CREATE INDEX IF NOT EXISTS nfc_tags_seal_images_missing_idx
  ON nfc_tags (id)
  WHERE seal_images_at IS NULL AND seal_code IS NOT NULL AND lifecycle_status IN ('ENROLLED', 'ACTIVE');

CREATE INDEX IF NOT EXISTS nfc_tags_seal_images_stale_idx
  ON nfc_tags (id)
  WHERE seal_images_at IS NOT NULL AND lifecycle_status NOT IN ('ENROLLED', 'ACTIVE');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'seal-images-tick') THEN
    PERFORM cron.unschedule('seal-images-tick');
  END IF;

  PERFORM cron.schedule(
    'seal-images-tick',
    '3-59/10 * * * *',
    $cron$
      SELECT net.http_post(
        url := b.decrypted_secret || '/api/v1/internal/seal-images',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'x-tick-secret', s.decrypted_secret
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      ) AS request_id
      FROM vault.decrypted_secrets b, vault.decrypted_secrets s
      WHERE b.name = 'backend_api_url' AND s.name = 'seal_images_tick_secret';
    $cron$
  );
EXCEPTION
  WHEN undefined_table OR invalid_schema_name OR undefined_function THEN
    RAISE NOTICE 'pg_cron not present: seal-images-tick not scheduled';
END $$;
