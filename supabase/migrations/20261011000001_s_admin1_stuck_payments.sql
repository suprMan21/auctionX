-- S-ADMIN1 Ph3a — stuck payments: atomic apply, incident queue, Re-apply, refund, sweep.
--
-- Implements the Locked decision "Paid-but-stuck transfers" (2026-10-03) and
-- extends it to re-issue fees (Ideas DB, 2026-10-09).
--
-- A token fee is "stuck" when Stripe says the PaymentIntent succeeded but the
-- row it pays for did not move: the webhook never arrived, the apply failed, the
-- transfer has no recipient, or the row was cancelled underneath the payment.
--
--   1. apply_transfer_fee / apply_reissue_fee: the ONE place a paid fee is
--      applied. The webhook, the sweep and the admin Re-apply all call these, so
--      there is no second copy of the rules. The transfer apply used to be five
--      separate writes from the webhook; a failure after the first left a
--      COMPLETED transfer whose token had not moved, and every retry then
--      stopped at "already completed". It is now one transaction.
--   2. payment_incidents: one row per stuck PaymentIntent. This is the admin
--      queue and the dedup key for the GitHub Issue.
--   3. admin_reapply_payment / admin_refund_payment_incident: the only admin
--      actions. Re-apply re-runs (1); nobody hand-edits ownership. Refund is
--      admin and super_admin only (Locked 2026-10-03).
--   4. A pg_cron tick every 10 minutes that calls the backend sweep.
--
-- Additive and idempotent: safe to re-run. No existing column, constraint or
-- function is changed.

-- ── 1. payment_incidents ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payment_incidents (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                     TEXT NOT NULL,
  -- Nullable: a PaymentIntent whose metadata names a row that does not exist is
  -- still an incident (reason row_missing).
  transfer_id              UUID REFERENCES public.ownership_transfers(id),
  reissue_request_id       UUID REFERENCES public.reissue_requests(id),
  stripe_payment_intent_id TEXT NOT NULL,
  reason                   TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'OPEN',
  resolution               TEXT,
  amount                   INTEGER,
  currency                 TEXT,
  first_seen_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  seen_count               INTEGER NOT NULL DEFAULT 1,
  -- A short machine code, never a message that could carry user data.
  last_error               TEXT,
  github_issue_number      INTEGER,
  github_issue_url         TEXT,
  github_claimed_at        TIMESTAMPTZ,
  github_last_comment_at   TIMESTAMPTZ,
  resolved_at              TIMESTAMPTZ,
  resolved_by              UUID REFERENCES public.users(id),
  resolved_reason          TEXT,
  stripe_refund_id         TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payment_incidents_kind_chk
    CHECK (kind IN ('transfer_fee', 'reissue_fee')),
  CONSTRAINT payment_incidents_reason_chk
    CHECK (reason IN ('webhook_missed', 'apply_failed', 'no_recipient', 'not_payable', 'intent_mismatch', 'row_missing')),
  CONSTRAINT payment_incidents_status_chk
    CHECK (status IN ('OPEN', 'RESOLVED', 'REFUNDED')),
  CONSTRAINT payment_incidents_resolution_chk
    CHECK (coalesce(resolution, '') IN ('', 'webhook', 'sweep', 'reapply', 'refund')),
  -- An open incident has no resolution; a closed one always says how and when.
  CONSTRAINT payment_incidents_closed_chk
    CHECK (
      (status = 'OPEN' AND resolution IS NULL AND resolved_at IS NULL)
      OR (status = 'RESOLVED' AND coalesce(resolution, '') IN ('webhook', 'sweep', 'reapply') AND resolved_at IS NOT NULL)
      OR (status = 'REFUNDED' AND coalesce(resolution, '') = 'refund' AND resolved_at IS NOT NULL
          AND length(btrim(coalesce(stripe_refund_id, ''))) > 0)
    )
);

-- One incident per PaymentIntent: the queue row and the GitHub Issue dedup key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_incidents_intent
  ON public.payment_incidents(stripe_payment_intent_id);

CREATE INDEX IF NOT EXISTS idx_payment_incidents_status
  ON public.payment_incidents(status, last_seen_at DESC);

-- Backend only. RLS on with no policy, and the blanket default privileges
-- revoked explicitly: nothing reads this table with a user-level key.
ALTER TABLE public.payment_incidents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_incidents FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.payment_incidents TO service_role;

COMMENT ON TABLE public.payment_incidents IS
  'S-ADMIN1 Ph3a: one row per token-fee PaymentIntent that succeeded in Stripe but did not apply. IDs only, no PII.';

-- ── 2. Who may act ──────────────────────────────────────────────────────────
-- Re-apply: support, admin, super_admin. Refund: admin, super_admin only.
-- Keyed on the role name because the Locked decision is worded by role, and
-- the seeded `support` role already carries process_refunds from the parked
-- marketplace, so that permission cannot be the refund gate here.

CREATE OR REPLACE FUNCTION payment_admin_actor_email(p_admin UUID, p_need_admin BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT au.email INTO v_email
    FROM admin_users a
    JOIN admin_roles r ON r.role_id = a.role_id
    JOIN auth.users au ON au.id = a.admin_id
   WHERE a.admin_id = p_admin
     AND a.is_active
     AND (
       r.role_name IN ('admin', 'super_admin')
       OR (NOT coalesce(p_need_admin, true) AND r.role_name = 'support')
     );

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'admin_forbidden: actor may not act on payments' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v_email;
END;
$$;

-- ── 3. Apply a paid transfer fee (one transaction) ──────────────────────────
-- Returns {"outcome": ...}. Expected states are outcomes, not exceptions, so a
-- caller can tell "nothing to do" from "stuck" without parsing an error:
--   applied            ownership moved, proof rotated
--   already_completed  a replay; nothing changed
--   not_found          no such transfer
--   intent_mismatch    the transfer stored a different PaymentIntent
--   not_payable        cancelled, or its chip is retired: the money is stranded
--   no_recipient       paid, but nobody to give the token to yet
-- Anything unexpected raises and rolls the whole apply back.
--
-- The caller must already know the PaymentIntent succeeded (a signed webhook
-- event, or a PaymentIntent fetched from Stripe). This function cannot check.

CREATE OR REPLACE FUNCTION apply_transfer_fee(
  p_transfer     UUID,
  p_intent       TEXT,
  p_ownership_id TEXT,
  p_tag_ref      TEXT,
  p_salt_enc     TEXT,
  p_source       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t   ownership_transfers%ROWTYPE;
  v_tag nfc_tags%ROWTYPE;
  v_now TIMESTAMPTZ := now();
BEGIN
  IF coalesce(p_source, '') NOT IN ('webhook', 'sweep', 'reapply') THEN
    RAISE EXCEPTION 'invalid_source' USING ERRCODE = 'check_violation';
  END IF;
  IF length(btrim(coalesce(p_intent, ''))) = 0 THEN
    RAISE EXCEPTION 'intent_required' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_t FROM ownership_transfers WHERE id = p_transfer FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  -- Bind to the intent this transfer created, so a succeeded intent from
  -- elsewhere cannot complete (or be reported as completing) someone else's.
  IF v_t.stripe_payment_intent_id IS NOT NULL AND v_t.stripe_payment_intent_id <> p_intent THEN
    RETURN jsonb_build_object('outcome', 'intent_mismatch', 'tag_id', v_t.tag_id);
  END IF;

  IF coalesce(v_t.status, '') = 'COMPLETED' THEN
    UPDATE payment_incidents
       SET status = 'RESOLVED', resolution = p_source, resolved_at = v_now
     WHERE stripe_payment_intent_id = p_intent AND status = 'OPEN';
    RETURN jsonb_build_object('outcome', 'already_completed', 'tag_id', v_t.tag_id);
  END IF;

  IF coalesce(v_t.status, '') <> 'PENDING' THEN
    RETURN jsonb_build_object('outcome', 'not_payable', 'tag_id', v_t.tag_id, 'status', v_t.status);
  END IF;
  IF v_t.to_user_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'no_recipient', 'tag_id', v_t.tag_id);
  END IF;

  SELECT * INTO v_tag FROM nfc_tags WHERE id = v_t.tag_id FOR UPDATE;
  IF NOT FOUND OR coalesce(v_tag.lifecycle_status::text, '') = 'RETIRED' THEN
    RETURN jsonb_build_object('outcome', 'not_payable', 'tag_id', v_t.tag_id, 'status', 'tag_retired');
  END IF;

  UPDATE ownership_transfers
     SET status                   = 'COMPLETED',
         transfer_fee_paid        = true,
         completed_at             = v_now,
         transferred_at           = v_now,
         stripe_payment_intent_id = p_intent
   WHERE id = p_transfer;

  -- Ownership moves here, and only here. A suspended token stays suspended:
  -- paying a transfer must not lift an admin suspension.
  UPDATE nfc_tags
     SET current_owner_id = v_t.to_user_id,
         lifecycle_status = CASE WHEN v_tag.lifecycle_status::text = 'SUSPENDED'
                                 THEN v_tag.lifecycle_status ELSE 'ACTIVE' END
   WHERE id = v_t.tag_id;

  UPDATE ownership_proofs SET status = 'stale'
   WHERE tag_id = v_t.tag_id AND status = 'current';

  INSERT INTO ownership_proofs (
    tag_id, ownership_event_id, ownership_event_type, ownership_id, tag_ref, salt_enc, owner_id, status
  ) VALUES (
    v_t.tag_id, p_transfer, 'transfer', p_ownership_id, p_tag_ref, p_salt_enc, v_t.to_user_id, 'current'
  );

  UPDATE payment_incidents
     SET status = 'RESOLVED', resolution = p_source, resolved_at = v_now
   WHERE stripe_payment_intent_id = p_intent AND status = 'OPEN';

  RETURN jsonb_build_object('outcome', 'applied', 'tag_id', v_t.tag_id, 'to_user_id', v_t.to_user_id);
END;
$$;

-- ── 4. Apply a paid re-issue fee: AWAITING_PAYMENT -> PAID, nothing else ────
-- Outcomes: applied | already_paid | not_found | intent_mismatch | not_payable.
-- Fulfilment stays a separate admin step with a chip in hand.

CREATE OR REPLACE FUNCTION apply_reissue_fee(
  p_request UUID,
  p_intent  TEXT,
  p_source  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req reissue_requests%ROWTYPE;
  v_now TIMESTAMPTZ := now();
BEGIN
  IF coalesce(p_source, '') NOT IN ('webhook', 'sweep', 'reapply') THEN
    RAISE EXCEPTION 'invalid_source' USING ERRCODE = 'check_violation';
  END IF;
  IF length(btrim(coalesce(p_intent, ''))) = 0 THEN
    RAISE EXCEPTION 'intent_required' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_req FROM reissue_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  -- The request must have stored THIS intent before handing out its secret.
  IF v_req.stripe_payment_intent_id IS DISTINCT FROM p_intent THEN
    RETURN jsonb_build_object('outcome', 'intent_mismatch');
  END IF;

  IF coalesce(v_req.payment_status, '') = 'PAID' THEN
    UPDATE payment_incidents
       SET status = 'RESOLVED', resolution = p_source, resolved_at = v_now
     WHERE stripe_payment_intent_id = p_intent AND status = 'OPEN';
    RETURN jsonb_build_object('outcome', 'already_paid', 'requester_id', v_req.requester_id,
                              'charged_amount', v_req.charged_amount);
  END IF;

  IF coalesce(v_req.status, '') <> 'APPROVED' OR coalesce(v_req.payment_status, '') <> 'AWAITING_PAYMENT' THEN
    RETURN jsonb_build_object('outcome', 'not_payable', 'status', v_req.status,
                              'payment_status', v_req.payment_status);
  END IF;

  UPDATE reissue_requests
     SET payment_status = 'PAID', paid_at = v_now
   WHERE id = p_request;

  UPDATE payment_incidents
     SET status = 'RESOLVED', resolution = p_source, resolved_at = v_now
   WHERE stripe_payment_intent_id = p_intent AND status = 'OPEN';

  RETURN jsonb_build_object('outcome', 'applied', 'requester_id', v_req.requester_id,
                            'charged_amount', v_req.charged_amount);
END;
$$;

-- ── 5. Record (or re-see) an incident ───────────────────────────────────────
-- One row per PaymentIntent. A repeat bumps the counter; a closed incident is
-- never reopened (a refunded payment that Stripe redelivers is not new work).
-- Returns the row plus is_new, which is what decides "open an Issue" versus
-- "comment on the existing one".
--
-- p_resolved_as: set by the sweep when it has ALREADY applied a payment whose
-- webhook never arrived. The incident is then born closed: there is nothing
-- for support to do, but a missed webhook is still worth a ticket.

CREATE OR REPLACE FUNCTION record_payment_incident(
  p_kind        TEXT,
  p_intent      TEXT,
  p_transfer    UUID,
  p_reissue     UUID,
  p_reason      TEXT,
  p_amount      INTEGER,
  p_currency    TEXT,
  p_error       TEXT,
  p_resolved_as TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transfer UUID := p_transfer;
  v_reissue  UUID := p_reissue;
  v_row      payment_incidents%ROWTYPE;
  v_new      BOOLEAN := false;
BEGIN
  IF p_resolved_as IS NOT NULL AND p_resolved_as NOT IN ('webhook', 'sweep', 'reapply') THEN
    RAISE EXCEPTION 'invalid_source' USING ERRCODE = 'check_violation';
  END IF;

  -- The ids come from PaymentIntent metadata. Drop one that names no row
  -- rather than fail the insert on its foreign key.
  IF v_transfer IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ownership_transfers WHERE id = v_transfer) THEN
    v_transfer := NULL;
  END IF;
  IF v_reissue IS NOT NULL AND NOT EXISTS (SELECT 1 FROM reissue_requests WHERE id = v_reissue) THEN
    v_reissue := NULL;
  END IF;

  INSERT INTO payment_incidents (
    kind, transfer_id, reissue_request_id, stripe_payment_intent_id, reason, amount, currency, last_error,
    status, resolution, resolved_at
  ) VALUES (
    p_kind, v_transfer, v_reissue, p_intent, p_reason, p_amount, p_currency, left(p_error, 120),
    CASE WHEN p_resolved_as IS NULL THEN 'OPEN' ELSE 'RESOLVED' END,
    p_resolved_as,
    CASE WHEN p_resolved_as IS NULL THEN NULL ELSE now() END
  )
  ON CONFLICT (stripe_payment_intent_id) DO NOTHING
  RETURNING * INTO v_row;

  IF FOUND THEN
    v_new := true;
  ELSIF p_resolved_as IS NULL THEN
    UPDATE payment_incidents
       SET last_seen_at = now(),
           seen_count   = seen_count + 1,
           reason       = p_reason,
           last_error   = left(p_error, 120)
     WHERE stripe_payment_intent_id = p_intent AND status = 'OPEN'
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
      SELECT * INTO v_row FROM payment_incidents WHERE stripe_payment_intent_id = p_intent;
    END IF;
  ELSE
    SELECT * INTO v_row FROM payment_incidents WHERE stripe_payment_intent_id = p_intent;
  END IF;

  RETURN to_jsonb(v_row) || jsonb_build_object('is_new', v_new);
END;
$$;

-- ── 6. Admin Re-apply ───────────────────────────────────────────────────────
-- Re-runs the same apply as the webhook, inside one transaction with the audit
-- row. An attempt that changes nothing is still audited, with its outcome.
-- The backend has already confirmed with Stripe that the intent succeeded and
-- is not refunded; the proof values are minted there (the salt key never
-- reaches the database).

CREATE OR REPLACE FUNCTION admin_reapply_payment(
  p_incident     UUID,
  p_admin        UUID,
  p_reason       TEXT,
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
  v_email TEXT := payment_admin_actor_email(p_admin, false);
  v_inc   payment_incidents%ROWTYPE;
  v_out   JSONB;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_inc FROM payment_incidents WHERE id = p_incident FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'incident_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_inc.status <> 'OPEN' THEN
    RAISE EXCEPTION 'incident_not_open: %', v_inc.status USING ERRCODE = 'check_violation';
  END IF;

  IF v_inc.kind = 'transfer_fee' AND v_inc.transfer_id IS NOT NULL THEN
    v_out := apply_transfer_fee(v_inc.transfer_id, v_inc.stripe_payment_intent_id,
                                p_ownership_id, p_tag_ref, p_salt_enc, 'reapply');
  ELSIF v_inc.kind = 'reissue_fee' AND v_inc.reissue_request_id IS NOT NULL THEN
    v_out := apply_reissue_fee(v_inc.reissue_request_id, v_inc.stripe_payment_intent_id, 'reapply');
  ELSE
    v_out := jsonb_build_object('outcome', 'not_found');
  END IF;

  IF v_out->>'outcome' IN ('applied', 'already_completed', 'already_paid') THEN
    UPDATE payment_incidents
       SET resolved_by = p_admin, resolved_reason = p_reason
     WHERE id = p_incident;
  ELSE
    UPDATE payment_incidents
       SET last_seen_at = now(), last_error = left('reapply_' || (v_out->>'outcome'), 120)
     WHERE id = p_incident;
  END IF;

  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, reason, brand)
  VALUES (
    p_admin, v_email, 'payment_reapply', 'payment_incident', p_incident,
    jsonb_build_object(
      'kind', v_inc.kind,
      'outcome', v_out->>'outcome',
      'transfer_id', v_inc.transfer_id,
      'reissue_request_id', v_inc.reissue_request_id,
      'payment_intent', v_inc.stripe_payment_intent_id
    ),
    p_reason, 'auctionx'
  );

  RETURN v_out || jsonb_build_object('incident_id', p_incident, 'kind', v_inc.kind);
END;
$$;

-- ── 7. Admin refund (admin and super_admin only) ────────────────────────────
-- Called AFTER Stripe accepted the refund: this records it. A still-PENDING
-- transfer is cancelled so the token is not left locked behind a payment that
-- no longer exists. A re-issue request is left as it is.

CREATE OR REPLACE FUNCTION admin_refund_payment_incident(
  p_incident  UUID,
  p_admin     UUID,
  p_reason    TEXT,
  p_refund_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email     TEXT := payment_admin_actor_email(p_admin, true);
  v_inc       payment_incidents%ROWTYPE;
  v_cancelled BOOLEAN := false;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'check_violation';
  END IF;
  IF length(btrim(coalesce(p_refund_id, ''))) = 0 THEN
    RAISE EXCEPTION 'refund_id_required' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_inc FROM payment_incidents WHERE id = p_incident FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'incident_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_inc.status <> 'OPEN' THEN
    RAISE EXCEPTION 'incident_not_open: %', v_inc.status USING ERRCODE = 'check_violation';
  END IF;

  IF v_inc.kind = 'transfer_fee' AND v_inc.transfer_id IS NOT NULL THEN
    UPDATE ownership_transfers
       SET status = 'CANCELLED'
     WHERE id = v_inc.transfer_id AND status = 'PENDING';
    v_cancelled := FOUND;
  END IF;

  UPDATE payment_incidents
     SET status           = 'REFUNDED',
         resolution       = 'refund',
         resolved_at      = now(),
         resolved_by      = p_admin,
         resolved_reason  = p_reason,
         stripe_refund_id = p_refund_id
   WHERE id = p_incident;

  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, reason, brand)
  VALUES (
    p_admin, v_email, 'payment_refund', 'payment_incident', p_incident,
    jsonb_build_object(
      'kind', v_inc.kind,
      'transfer_id', v_inc.transfer_id,
      'reissue_request_id', v_inc.reissue_request_id,
      'payment_intent', v_inc.stripe_payment_intent_id,
      'refund_id', p_refund_id,
      'amount', v_inc.amount,
      'currency', v_inc.currency,
      'transfer_cancelled', v_cancelled
    ),
    p_reason, 'auctionx'
  );

  RETURN jsonb_build_object('incident_id', p_incident, 'status', 'REFUNDED', 'transfer_cancelled', v_cancelled);
END;
$$;

-- ── 8. Grants: backend (service_role) only ──────────────────────────────────

REVOKE ALL ON FUNCTION payment_admin_actor_email(UUID, BOOLEAN)                               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION apply_transfer_fee(UUID, TEXT, TEXT, TEXT, TEXT, TEXT)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION apply_reissue_fee(UUID, TEXT, TEXT)                                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION record_payment_incident(TEXT, TEXT, UUID, UUID, TEXT, INTEGER, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_reapply_payment(UUID, UUID, TEXT, TEXT, TEXT, TEXT)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_refund_payment_incident(UUID, UUID, TEXT, TEXT)                  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION apply_transfer_fee(UUID, TEXT, TEXT, TEXT, TEXT, TEXT)                 TO service_role;
GRANT EXECUTE ON FUNCTION apply_reissue_fee(UUID, TEXT, TEXT)                                    TO service_role;
GRANT EXECUTE ON FUNCTION record_payment_incident(TEXT, TEXT, UUID, UUID, TEXT, INTEGER, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION admin_reapply_payment(UUID, UUID, TEXT, TEXT, TEXT, TEXT)              TO service_role;
GRANT EXECUTE ON FUNCTION admin_refund_payment_incident(UUID, UUID, TEXT, TEXT)                  TO service_role;

-- ── 9. Sweep tick: every 10 minutes ─────────────────────────────────────────
-- pg_cron -> pg_net -> POST <backend>/api/v1/internal/token-fee-sweep, with a
-- shared secret. The backend (not the database) talks to Stripe.
--
-- Both values come from Vault. Until BOTH exist the tick selects no row and
-- sends nothing, so applying this migration before the secrets are set is safe:
--   SELECT vault.create_secret('<backend base URL, no trailing slash>', 'backend_api_url');
--   SELECT vault.create_secret('<same value as TOKEN_FEE_SWEEP_SECRET>', 'token_fee_sweep_secret');
--
-- In-process timers are not an option: App Runner throttles CPU between
-- requests, so a setInterval there does not fire on time.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'token-fee-sweep-tick') THEN
    PERFORM cron.unschedule('token-fee-sweep-tick');
  END IF;

  PERFORM cron.schedule(
    'token-fee-sweep-tick',
    '*/10 * * * *',
    $cron$
      SELECT net.http_post(
        url := b.decrypted_secret || '/api/v1/internal/token-fee-sweep',
        headers := jsonb_build_object(
          'Content-Type',   'application/json',
          'x-sweep-secret', s.decrypted_secret
        ),
        body := '{}'::jsonb
      ) AS request_id
      FROM vault.decrypted_secrets b, vault.decrypted_secrets s
      WHERE b.name = 'backend_api_url' AND s.name = 'token_fee_sweep_secret';
    $cron$
  );
EXCEPTION
  -- pg_cron is not installed on a local or shadow instance. The sweep can
  -- still be run from the admin queue, so this must not fail the migration.
  WHEN undefined_table OR invalid_schema_name OR undefined_function THEN
    RAISE NOTICE 'pg_cron not present: token-fee-sweep-tick not scheduled';
END $$;
