-- S-NFC3-FE Ph1 — tap sessions.
--
-- A chip tap is single-use: verifying it burns the SUN counter (anti-replay).
-- The public verify page is where a tap lands, so it must verify (and burn)
-- the tap. Claim and transfer completion ALSO need a fresh tap as proof of
-- possession. Without this table the verify page would always consume the tap
-- the claim needs.
--
-- POST /api/v1/nfc/tap verifies + burns the tap and mints a tap session: a
-- random bearer token, valid for 10 minutes, usable ONCE, bound to the chip and
-- to the counter value that was burned. /claim and /transfer/:id/complete
-- accept it in place of a raw SUN message.
--
-- Only the SHA-256 of the token is stored. A session is honoured only while its
-- counter is still the chip's latest (a newer tap by anyone supersedes it).
--
-- Service role only: RLS on, no policies, and the blanket anon/authenticated
-- grants from ALTER DEFAULT PRIVILEGES revoked (the mechanism behind the S-ISO1
-- aes_key_enc exposure).
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.nfc_tap_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_id        uuid NOT NULL REFERENCES public.nfc_tags(id) ON DELETE CASCADE,
  token_hash    text NOT NULL,
  counter_value integer NOT NULL,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  consumed_by   uuid REFERENCES public.users(id),
  consumed_for  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nfc_tap_sessions_token_hash_key UNIQUE (token_hash),
  CONSTRAINT nfc_tap_sessions_token_hash_chk CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT nfc_tap_sessions_consumed_for_chk
    CHECK (consumed_for IS NULL OR consumed_for IN ('claim', 'transfer_complete')),
  CONSTRAINT nfc_tap_sessions_consumed_chk
    CHECK ((consumed_at IS NULL) = (consumed_for IS NULL))
);

CREATE INDEX IF NOT EXISTS nfc_tap_sessions_tag_id_idx ON public.nfc_tap_sessions (tag_id);
CREATE INDEX IF NOT EXISTS nfc_tap_sessions_expires_at_idx ON public.nfc_tap_sessions (expires_at);

ALTER TABLE public.nfc_tap_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.nfc_tap_sessions FROM anon, authenticated;

COMMENT ON TABLE public.nfc_tap_sessions IS
  'S-NFC3-FE: single-use, 10-minute proof-of-possession tokens minted by POST '
  '/nfc/tap after a verified (and burned) SUN tap. Stores only SHA-256 of the '
  'token. Service role only.';
