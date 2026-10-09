-- S-ADMIN1 Ph2 — re-issue queue: review, payment state, fulfilment.
--
-- A re-issue replaces a chip that is coming loose, BEFORE it falls off, for the
-- registered owner (Boss, 2026-10-09). A chip that has already come off is not
-- replaced. The request carries proof: a live verified tap of the old chip
-- (tap session, single use) and 1–3 photos from the web app's live camera.
--
-- Lifecycle (status CHECK unchanged; payment state is a new optional column):
--   PENDING ──approve──> APPROVED + AWAITING_PAYMENT ──webhook──> PAID ──fulfil──> fulfilled_at set
--           └─approve + waive──> APPROVED + WAIVED ─────────────────────fulfil──┘
--   PENDING ──reject──> REJECTED (no charge)
--   PENDING / AWAITING_PAYMENT ──owner cancel──> CANCELLED
--
-- Nothing is fulfilled unpaid unless an admin waived the fee with a reason.
-- Fulfil runs the Ph1 admin_reset_token in the same transaction.
--
-- Additive and idempotent: safe to re-run.

-- ── 1. Tap sessions may now be spent on a re-issue request ──────────────────
-- Widening a CHECK (appending an allowed value): drop and re-add.

ALTER TABLE public.nfc_tap_sessions DROP CONSTRAINT IF EXISTS nfc_tap_sessions_consumed_for_chk;
ALTER TABLE public.nfc_tap_sessions
  ADD CONSTRAINT nfc_tap_sessions_consumed_for_chk
  CHECK (consumed_for IS NULL OR consumed_for IN ('claim', 'transfer_complete', 'reissue_request'));

-- ── 2. reissue_requests: new optional columns ───────────────────────────────

ALTER TABLE public.reissue_requests ADD COLUMN IF NOT EXISTS payment_status TEXT;
ALTER TABLE public.reissue_requests ADD COLUMN IF NOT EXISTS tap_session_id UUID REFERENCES public.nfc_tap_sessions(id);
ALTER TABLE public.reissue_requests ADD COLUMN IF NOT EXISTS photo_keys     TEXT[];
ALTER TABLE public.reissue_requests ADD COLUMN IF NOT EXISTS review_reason  TEXT;
ALTER TABLE public.reissue_requests ADD COLUMN IF NOT EXISTS waive_reason   TEXT;
ALTER TABLE public.reissue_requests ADD COLUMN IF NOT EXISTS paid_at        TIMESTAMPTZ;
ALTER TABLE public.reissue_requests ADD COLUMN IF NOT EXISTS fulfilled_at   TIMESTAMPTZ;
ALTER TABLE public.reissue_requests ADD COLUMN IF NOT EXISTS fulfilled_by   UUID REFERENCES public.users(id);
ALTER TABLE public.reissue_requests ADD COLUMN IF NOT EXISTS new_tag_id     UUID REFERENCES public.nfc_tags(id);

DO $$ BEGIN
  ALTER TABLE public.reissue_requests
    ADD CONSTRAINT reissue_requests_payment_status_chk
    CHECK (payment_status IS NULL OR payment_status IN ('AWAITING_PAYMENT', 'PAID', 'WAIVED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.reissue_requests
    ADD CONSTRAINT reissue_requests_photo_keys_chk
    CHECK (photo_keys IS NULL OR cardinality(photo_keys) BETWEEN 1 AND 3);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A waived request always says why.
DO $$ BEGIN
  ALTER TABLE public.reissue_requests
    ADD CONSTRAINT reissue_requests_waive_reason_chk
    CHECK (payment_status IS DISTINCT FROM 'WAIVED' OR length(btrim(waive_reason)) >= 10);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Fulfilment only ever follows payment or a waiver.
DO $$ BEGIN
  ALTER TABLE public.reissue_requests
    ADD CONSTRAINT reissue_requests_fulfil_paid_chk
    CHECK (fulfilled_at IS NULL OR payment_status IN ('PAID', 'WAIVED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One PaymentIntent belongs to one request.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reissue_requests_payment_intent
  ON public.reissue_requests(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- One open request per TAG (the S-NFC3 index is per tag + requester and only
-- covers PENDING; an approved-but-unfulfilled request is still open).
CREATE UNIQUE INDEX IF NOT EXISTS idx_reissue_requests_one_open_per_tag
  ON public.reissue_requests(tag_id)
  WHERE status = 'PENDING' OR (status = 'APPROVED' AND fulfilled_at IS NULL);

-- ── 3. Review: approve (charge or waive) / reject ───────────────────────────

CREATE OR REPLACE FUNCTION admin_review_reissue(
  p_request UUID,
  p_admin   UUID,
  p_approve BOOLEAN,
  p_waive   BOOLEAN,
  p_reason  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email   TEXT := admin_nfc_actor_email(p_admin);
  v_req     reissue_requests%ROWTYPE;
  v_tag     nfc_tags%ROWTYPE;
  v_status  TEXT;
  v_payment TEXT;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'check_violation';
  END IF;
  IF p_waive AND NOT p_approve THEN
    RAISE EXCEPTION 'waive_requires_approve' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_req FROM reissue_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_req.status IS DISTINCT FROM 'PENDING' THEN
    RAISE EXCEPTION 'request_invalid_state: %', v_req.status USING ERRCODE = 'check_violation';
  END IF;

  IF p_approve THEN
    SELECT * INTO v_tag FROM nfc_tags WHERE id = v_req.tag_id;
    IF v_tag.lifecycle_status NOT IN ('ACTIVE', 'SUSPENDED') THEN
      RAISE EXCEPTION 'tag_invalid_state: %', v_tag.lifecycle_status USING ERRCODE = 'check_violation';
    END IF;
    -- The token may have changed hands since the request was filed.
    IF v_tag.current_owner_id IS DISTINCT FROM v_req.requester_id THEN
      RAISE EXCEPTION 'requester_not_owner' USING ERRCODE = 'check_violation';
    END IF;
    v_status  := 'APPROVED';
    v_payment := CASE WHEN p_waive THEN 'WAIVED' ELSE 'AWAITING_PAYMENT' END;
  ELSE
    v_status  := 'REJECTED';
    v_payment := NULL;
  END IF;

  UPDATE reissue_requests
     SET status         = v_status,
         payment_status = v_payment,
         review_reason  = p_reason,
         waive_reason   = CASE WHEN p_waive THEN p_reason ELSE NULL END,
         reviewed_by    = p_admin,
         reviewed_at    = now()
   WHERE id = p_request;

  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, reason, brand)
  VALUES (
    p_admin, v_email,
    CASE WHEN NOT p_approve THEN 'reissue_reject'
         WHEN p_waive       THEN 'reissue_approve_waived'
         ELSE                    'reissue_approve' END,
    'reissue_request', p_request,
    jsonb_build_object(
      'tag_id', v_req.tag_id,
      'before', jsonb_build_object('status', v_req.status, 'payment_status', v_req.payment_status),
      'after',  jsonb_build_object('status', v_status, 'payment_status', v_payment)
    ),
    p_reason, 'auctionx'
  );

  RETURN jsonb_build_object('status', v_status, 'payment_status', v_payment);
END;
$$;

-- ── 4. Fulfil: reset onto the new chip, only once paid or waived ────────────
-- Calls admin_reset_token in this same transaction: it does the lifecycle
-- checks (old ACTIVE/SUSPENDED, new ENROLLED, no pending transfer), moves the
-- token, rotates the Ownership ID and writes its own tag_reset audit row.

CREATE OR REPLACE FUNCTION admin_fulfil_reissue(
  p_request      UUID,
  p_new_tag      UUID,
  p_admin        UUID,
  p_reason       TEXT,
  p_custody_id   UUID,
  p_ownership_id TEXT,
  p_tag_ref      TEXT,
  p_salt_enc     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email  TEXT := admin_nfc_actor_email(p_admin);
  v_req    reissue_requests%ROWTYPE;
  v_owner  UUID;
  v_result JSONB;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_req FROM reissue_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_req.status IS DISTINCT FROM 'APPROVED' THEN
    RAISE EXCEPTION 'request_invalid_state: %', v_req.status USING ERRCODE = 'check_violation';
  END IF;
  IF v_req.fulfilled_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_fulfilled' USING ERRCODE = 'check_violation';
  END IF;
  -- Nothing goes through unpaid (Boss, 2026-10-09).
  IF v_req.payment_status IS DISTINCT FROM 'PAID' AND v_req.payment_status IS DISTINCT FROM 'WAIVED' THEN
    RAISE EXCEPTION 'not_paid: %', coalesce(v_req.payment_status, 'none') USING ERRCODE = 'check_violation';
  END IF;

  SELECT current_owner_id INTO v_owner FROM nfc_tags WHERE id = v_req.tag_id;
  IF v_owner IS DISTINCT FROM v_req.requester_id THEN
    RAISE EXCEPTION 'requester_not_owner' USING ERRCODE = 'check_violation';
  END IF;

  v_result := admin_reset_token(
    v_req.tag_id, p_new_tag, p_admin, p_reason, p_custody_id, p_ownership_id, p_tag_ref, p_salt_enc
  );

  UPDATE reissue_requests
     SET fulfilled_at = now(),
         fulfilled_by = p_admin,
         new_tag_id   = p_new_tag
   WHERE id = p_request;

  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, reason, brand)
  VALUES (
    p_admin, v_email, 'reissue_fulfil', 'reissue_request', p_request,
    jsonb_build_object(
      'tag_id', v_req.tag_id,
      'new_tag_id', p_new_tag,
      'payment_status', v_req.payment_status,
      'custody_record_id', p_custody_id
    ),
    p_reason, 'auctionx'
  );

  RETURN v_result || jsonb_build_object('request_id', p_request);
END;
$$;

-- ── 5. Grants: backend (service_role) only ──────────────────────────────────

REVOKE ALL ON FUNCTION admin_review_reissue(UUID, UUID, BOOLEAN, BOOLEAN, TEXT)                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_fulfil_reissue(UUID, UUID, UUID, TEXT, UUID, TEXT, TEXT, TEXT)        FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_review_reissue(UUID, UUID, BOOLEAN, BOOLEAN, TEXT)                 TO service_role;
GRANT EXECUTE ON FUNCTION admin_fulfil_reissue(UUID, UUID, UUID, TEXT, UUID, TEXT, TEXT, TEXT)     TO service_role;
