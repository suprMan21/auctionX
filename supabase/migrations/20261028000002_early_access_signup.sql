-- S-SITE2 G3: early-access signup from authentic-materials.com.
--
-- Decisions DB (Locked 2026-10-28): "Landing-only site exception" + "Early-access
-- signup: one backend route saves and sends; DB webhook retired".
--
--  1. Consent (CASL): the exact wording shown and when it was given.
--  2. Unsubscribe and welcome-email bookkeeping.
--  3. Writes go through the backend (service role) only. The old open INSERT
--     policy let anyone with the publishable key add rows with no rate limit and
--     told a caller whether an address was already on the list.
--  4. The S23.5 webhook trigger is retired: the backend sends the welcome email,
--     so a bulk copy of these rows to prod can never re-email the list.
--
-- Optional columns only (schema extension rules).

ALTER TABLE public.waitlist_signups
  ADD COLUMN IF NOT EXISTS consent_text    TEXT,
  ADD COLUMN IF NOT EXISTS consent_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS welcome_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.waitlist_signups.consent_text IS
  'Exact consent wording shown at signup (CASL express consent). NULL for pre-S-SITE2 rows.';
COMMENT ON COLUMN public.waitlist_signups.unsubscribed_at IS
  'Set by the unsubscribe link; no email is sent to this row while set.';

-- Spike checks count recent signups.
CREATE INDEX IF NOT EXISTS waitlist_signups_created_at_idx ON public.waitlist_signups (created_at);

DROP POLICY IF EXISTS "Anyone can sign up for waitlist" ON public.waitlist_signups;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.waitlist_signups FROM anon, authenticated;
REVOKE SELECT ON public.waitlist_signups FROM anon;

DROP TRIGGER IF EXISTS waitlist_welcome ON public.waitlist_signups;
