-- S-MOB2 Ph A — recorded sealing: counter ledger, seal baseline, seal sessions, seals, commit_seal
--
-- Plan + counter-rule review: docs/plans/2026-10-29-s-mob2.md (Boss 2026-10-29: D1 ledger, D2 gap = reject,
-- D3 any Creator with an unclaimed chip, D4 device attestation deferred to S-SEC1).
--
-- 1. nfc_counter_ledger (tag_id, counter) unique. Every counter the server accepts is stored. Public taps,
--    claims and transfers are recorded by a trigger on nfc_tags.sun_counter (no app change); seal taps are
--    inserted by commit_seal. Public / claim / transfer keep the strict high-water rule unchanged.
-- 2. nfc_tags.seal_baseline_counter: everything at or below it counts as spent (taps before the ledger
--    existed were never recorded). Existing rows = their sun_counter now; new rows = sun_counter at insert.
--    Write-once.
-- 3. seal_sessions: optional, created online at tap 1, gives the record a server time. Bound to creator + serial.
-- 4. nfc_seals: one seal per chip. Permanent once committed.
-- 5. commit_seal(): the only out-of-order acceptance. Requires baseline < c1, c2 = c1 + 1 (no read between the
--    taps), neither counter in the ledger, chip ENROLLED with no owner. One transaction, row locked.
-- 6. step_up_grants action 'seal'.
--
-- Every new table: RLS on, no policies, no anon/authenticated grants (service role only).
-- Every new SECURITY DEFINER function: EXECUTE revoked from PUBLIC, anon, authenticated.

-- ── 1. Ledger ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nfc_counter_ledger (
  tag_id      UUID        NOT NULL REFERENCES public.nfc_tags(id) ON DELETE CASCADE,
  counter     INTEGER     NOT NULL,
  source      TEXT        NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tag_id, counter),
  CONSTRAINT nfc_counter_ledger_source_chk CHECK (coalesce(source, '') IN ('tap', 'seal')),
  CONSTRAINT nfc_counter_ledger_counter_chk CHECK (coalesce(counter, -1) >= 0)
);
ALTER TABLE public.nfc_counter_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nfc_counter_ledger FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.nfc_counter_ledger TO service_role;

COMMENT ON TABLE public.nfc_counter_ledger IS
  'S-MOB2: every chip read counter the server has accepted. Used only by commit_seal to accept delayed seal taps '
  'without accepting a counter twice. Service role only.';

-- ── 2. Seal baseline ────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE public.nfc_tags ADD COLUMN seal_baseline_counter INTEGER;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

COMMENT ON COLUMN public.nfc_tags.seal_baseline_counter IS
  'S-MOB2: a seal tap counter must be above this. Set once (existing rows: sun_counter when the ledger started; '
  'new rows: sun_counter at insert). Write-once.';

UPDATE public.nfc_tags SET seal_baseline_counter = sun_counter WHERE seal_baseline_counter IS NULL;

CREATE OR REPLACE FUNCTION public.nfc_tags_seal_baseline()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.seal_baseline_counter := coalesce(NEW.sun_counter, 0);
  ELSIF OLD.seal_baseline_counter IS NOT NULL
        AND NEW.seal_baseline_counter IS DISTINCT FROM OLD.seal_baseline_counter THEN
    RAISE EXCEPTION 'seal_baseline_counter is write-once' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.nfc_tags_seal_baseline() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS nfc_tags_seal_baseline ON public.nfc_tags;
CREATE TRIGGER nfc_tags_seal_baseline
  BEFORE INSERT OR UPDATE OF seal_baseline_counter ON public.nfc_tags
  FOR EACH ROW EXECUTE FUNCTION public.nfc_tags_seal_baseline();

-- Every accepted tap raises sun_counter; record the new value.
CREATE OR REPLACE FUNCTION public.nfc_tags_record_counter()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.nfc_counter_ledger (tag_id, counter, source)
  VALUES (NEW.id, NEW.sun_counter, 'tap')
  ON CONFLICT (tag_id, counter) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.nfc_tags_record_counter() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS nfc_tags_record_counter ON public.nfc_tags;
CREATE TRIGGER nfc_tags_record_counter
  AFTER UPDATE OF sun_counter ON public.nfc_tags
  FOR EACH ROW
  WHEN (NEW.sun_counter > OLD.sun_counter)
  EXECUTE FUNCTION public.nfc_tags_record_counter();

-- ── 3. Seal sessions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seal_sessions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id  UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  chip_serial TEXT        NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours',
  used_at     TIMESTAMPTZ,
  CONSTRAINT seal_sessions_serial_chk CHECK (length(coalesce(chip_serial, '')) BETWEEN 1 AND 64)
);
CREATE INDEX IF NOT EXISTS seal_sessions_creator_idx ON public.seal_sessions (creator_id, started_at DESC);
ALTER TABLE public.seal_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seal_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.seal_sessions TO service_role;

COMMENT ON TABLE public.seal_sessions IS
  'S-MOB2: started online at tap 1 (optional) so the seal record carries a server time. Single use, 24 h.';

-- ── 4. Seals ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nfc_seals (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_id                   UUID        NOT NULL UNIQUE REFERENCES public.nfc_tags(id),
  creator_id               UUID        NOT NULL REFERENCES public.users(id),
  session_id               UUID        REFERENCES public.seal_sessions(id),
  tap1_counter             INTEGER     NOT NULL,
  tap2_counter             INTEGER     NOT NULL,
  tap1_device_at           TIMESTAMPTZ NOT NULL,
  tap2_device_at           TIMESTAMPTZ NOT NULL,
  server_started_at        TIMESTAMPTZ,
  video_sha256             TEXT        NOT NULL,
  applied_before_recording BOOLEAN     NOT NULL DEFAULT false,
  video_status             TEXT        NOT NULL DEFAULT 'pending_upload',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT nfc_seals_counters_chk CHECK (coalesce(tap2_counter, 0) = coalesce(tap1_counter, 0) + 1),
  CONSTRAINT nfc_seals_video_sha_chk CHECK (coalesce(video_sha256, '') ~ '^[0-9a-f]{64}$'),
  CONSTRAINT nfc_seals_video_status_chk CHECK (coalesce(video_status, '') IN
    ('pending_upload', 'in_review', 'live', 'unavailable', 'removed'))
);
CREATE INDEX IF NOT EXISTS nfc_seals_creator_idx ON public.nfc_seals (creator_id, created_at DESC);
ALTER TABLE public.nfc_seals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nfc_seals FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.nfc_seals TO service_role;

COMMENT ON TABLE public.nfc_seals IS
  'S-MOB2: a recorded seal. Two consecutive chip counters bracket the video; video_sha256 commits to the file '
  'uploaded later (Ph C). Permanent. Service role only.';

-- ── 5. commit_seal ──────────────────────────────────────────────────────────
-- MACs are checked by the backend before this runs (keys never reach the DB). This function owns every
-- counter and state rule, under a row lock, so two commits for one chip cannot both win.
-- Returns { status: ok | not_found | already_claimed | not_sealable | below_baseline | gap | counter_spent
--           | session_invalid, seal_id? }.
CREATE OR REPLACE FUNCTION public.commit_seal(
  p_tag_id                   UUID,
  p_creator_id               UUID,
  p_tap1_counter             INTEGER,
  p_tap2_counter             INTEGER,
  p_tap1_device_at           TIMESTAMPTZ,
  p_tap2_device_at           TIMESTAMPTZ,
  p_video_sha256             TEXT,
  p_session_id               UUID,
  p_applied_before_recording BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tag      public.nfc_tags%ROWTYPE;
  v_session  public.seal_sessions%ROWTYPE;
  v_started  TIMESTAMPTZ;
  v_seal_id  UUID;
BEGIN
  SELECT * INTO v_tag FROM public.nfc_tags WHERE id = p_tag_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF v_tag.lifecycle_status IS DISTINCT FROM 'ENROLLED' OR v_tag.current_owner_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.nfc_seals WHERE tag_id = p_tag_id) THEN
    RETURN jsonb_build_object('status', 'already_claimed');
  END IF;

  -- Sealing needs a v2 chip (serial in the URL) that is not suspended.
  IF v_tag.chip_serial IS NULL OR v_tag.suspended_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'not_sealable');
  END IF;

  IF p_tap1_counter IS NULL OR p_tap2_counter IS NULL
     OR p_tap1_counter <= coalesce(v_tag.seal_baseline_counter, v_tag.sun_counter) THEN
    RETURN jsonb_build_object('status', 'below_baseline');
  END IF;

  -- D2 (Boss 2026-10-29): anything read the chip between the taps → the take is void.
  IF p_tap2_counter <> p_tap1_counter + 1 THEN
    RETURN jsonb_build_object('status', 'gap');
  END IF;

  IF EXISTS (SELECT 1 FROM public.nfc_counter_ledger
             WHERE tag_id = p_tag_id AND counter BETWEEN p_tap1_counter AND p_tap2_counter) THEN
    RETURN jsonb_build_object('status', 'counter_spent');
  END IF;

  IF p_session_id IS NOT NULL THEN
    SELECT * INTO v_session FROM public.seal_sessions WHERE id = p_session_id FOR UPDATE;
    IF NOT FOUND OR v_session.creator_id <> p_creator_id OR v_session.chip_serial <> v_tag.chip_serial
       OR v_session.used_at IS NOT NULL OR v_session.expires_at <= now() THEN
      RETURN jsonb_build_object('status', 'session_invalid');
    END IF;
    UPDATE public.seal_sessions SET used_at = now() WHERE id = p_session_id;
    v_started := v_session.started_at;
  END IF;

  INSERT INTO public.nfc_counter_ledger (tag_id, counter, source)
  VALUES (p_tag_id, p_tap1_counter, 'seal'), (p_tag_id, p_tap2_counter, 'seal');

  INSERT INTO public.nfc_seals (
    tag_id, creator_id, session_id, tap1_counter, tap2_counter, tap1_device_at, tap2_device_at,
    server_started_at, video_sha256, applied_before_recording)
  VALUES (
    p_tag_id, p_creator_id, p_session_id, p_tap1_counter, p_tap2_counter, p_tap1_device_at, p_tap2_device_at,
    v_started, p_video_sha256, coalesce(p_applied_before_recording, false))
  RETURNING id INTO v_seal_id;

  -- Same state change as an origin claim. sun_counter only ever rises (the trigger skips equal values,
  -- and the ledger already holds c2).
  UPDATE public.nfc_tags
     SET lifecycle_status = 'ACTIVE',
         current_owner_id = p_creator_id,
         sun_counter      = greatest(sun_counter, p_tap2_counter),
         activated_at     = now(),
         status           = 'active'
   WHERE id = p_tag_id;

  RETURN jsonb_build_object('status', 'ok', 'seal_id', v_seal_id);
END $$;
REVOKE EXECUTE ON FUNCTION public.commit_seal(UUID, UUID, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_seal(UUID, UUID, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID, BOOLEAN)
  TO service_role;

-- ── 6. 'seal' step-up ───────────────────────────────────────────────────────
ALTER TABLE public.step_up_grants DROP CONSTRAINT IF EXISTS step_up_grants_action_chk;
ALTER TABLE public.step_up_grants ADD CONSTRAINT step_up_grants_action_chk CHECK (coalesce(action, '') IN (
  'release', 'transfer_complete', 'price_change', 'factor_remove', 'factor_add', 'recovery_regen',
  'admin_action', 'admin_approve', 'account_change', 'recovery_undo', 'recovery_channel', 'seal'));
