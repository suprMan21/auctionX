-- S-2FA Ph4: record which maker a passkey's attestation proved (security review M1).
-- The break-glass (super_admin) account signs in and confirms step-ups only with a
-- passkey whose attestation chained to a pinned root at registration
-- (backend lib/mfa/hardwareKeyAttestation.ts). NULL = not attested (everyone else,
-- and every passkey added before Ph4). Optional column only (schema extension rules).

ALTER TABLE public.user_passkeys ADD COLUMN IF NOT EXISTS attested_vendor text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_passkeys_attested_vendor_check') THEN
    ALTER TABLE public.user_passkeys
      ADD CONSTRAINT user_passkeys_attested_vendor_check
      CHECK (attested_vendor IS NULL OR attested_vendor IN ('yubico'));
  END IF;
END $$;

COMMENT ON COLUMN public.user_passkeys.attested_vendor IS
  'S-2FA Ph4: maker proven by attestation at registration (yubico), NULL if not attested. Break-glass sign-in requires it.';
