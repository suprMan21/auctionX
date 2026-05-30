-- =====================================================================
-- Yoti integration — additive schema only.
--
-- Reuses existing columns:
--   users.seller_verification_status  (verification_status enum, already wired)
--   users.age_verified                (boolean)
--   users.age_verified_at             (timestamptz)
--   users.age_verification_provider   (text — we set to 'yoti')
--   users.seller_verification_submitted_at / reviewed_at / rejection_reason
--
-- Adds:
--   3 nullable columns on public.users for Yoti session bookkeeping
--   public.yoti_sessions table (audit / event log) with RLS owner-only read
--
-- Does NOT touch the legacy doc-pipeline tables (seller_verification_documents
-- + seller_verification_reviews) — those stay intact per Schema Extension Rules.
-- The override audit trail piggy-backs on seller_verification_reviews.
-- =====================================================================

-- 4.2: New optional columns on users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS yoti_session_id TEXT,
  ADD COLUMN IF NOT EXISTS yoti_age_estimate INTEGER,
  ADD COLUMN IF NOT EXISTS yoti_last_event_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_yoti_session_id
  ON public.users(yoti_session_id)
  WHERE yoti_session_id IS NOT NULL;

-- 4.3: yoti_sessions table (audit/event log)
CREATE TABLE IF NOT EXISTS public.yoti_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  yoti_session_id TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('seller_kyc', 'age_gate', 'both')),
  status TEXT NOT NULL CHECK (status IN ('created', 'in_progress', 'completed', 'failed', 'expired')),
  age_estimate INTEGER,
  rejection_reason TEXT,
  last_event_type TEXT,
  last_event_at TIMESTAMPTZ,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.yoti_sessions ENABLE ROW LEVEL SECURITY;

-- Users can read only their own sessions.
-- INSERT/UPDATE only via service role (webhook handler) — no user-facing policies on those.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'yoti_sessions'
      AND policyname = 'Users can view own yoti sessions'
  ) THEN
    CREATE POLICY "Users can view own yoti sessions"
      ON public.yoti_sessions FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END$$;

-- updated_at maintenance trigger
CREATE OR REPLACE FUNCTION public.touch_yoti_sessions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_yoti_sessions_updated_at ON public.yoti_sessions;
CREATE TRIGGER trg_yoti_sessions_updated_at
BEFORE UPDATE ON public.yoti_sessions
FOR EACH ROW
EXECUTE FUNCTION public.touch_yoti_sessions_updated_at();

-- Helpful lookup indices
CREATE INDEX IF NOT EXISTS idx_yoti_sessions_user_id ON public.yoti_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_yoti_sessions_status ON public.yoti_sessions(status);

COMMENT ON TABLE public.yoti_sessions IS
  'Audit/event log for Yoti hosted IDV sessions. Truth lives in users.seller_verification_status + users.age_verified; this table is the per-session forensic record. raw_payload retains the verified webhook body — strip PII before logging anywhere outside the DB.';
