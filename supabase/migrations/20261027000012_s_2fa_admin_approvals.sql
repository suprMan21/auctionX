-- =============================================================================
-- S-2FA Ph3a: two-admin approval (Boss 2026-10-27).
--
-- The daily admins (admin@, admin2@) approve each other's token reset, token
-- suspend, account suspend and account retire. super_admin is break-glass and
-- acts alone: its role holds `act_without_approval` (enum added in ...000011).
-- The backend decides whether a request must wait (flag FEATURE_ADMIN_TWO_PERSON
-- + that permission); these functions hold the rules that must never be skipped:
--
--   * the request and every decision write an audit_logs row in the same
--     transaction, before anything runs (fail closed);
--   * the payload is stored exactly as requested and runs as stored;
--   * nobody decides their own request (CHECK + function), cancel = requester only;
--   * one open request per (action, target);
--   * a request lasts 24 h, then it is expired and can only be asked again.
--
-- New table and functions only; no existing table or column changes.
-- Live checks: supabase/tests/s_2fa_ph3a_approvals_live.sql
-- =============================================================================

-- ── 1. Permission grant ─────────────────────────────────────────────────────
UPDATE admin_roles
   SET permissions = (SELECT array_agg(DISTINCT p ORDER BY p)
                        FROM unnest(permissions || ARRAY['act_without_approval']::admin_permission[]) p)
 WHERE role_name = 'super_admin';

-- ── 2. Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_action_approvals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action        TEXT NOT NULL CHECK (action IN ('tag_reset', 'tag_suspend', 'account_suspend', 'account_retire')),
  target_id     UUID NOT NULL,
  -- The exact parsed request body. It runs as stored, never re-read from the requester.
  payload       JSONB NOT NULL,
  payload_hash  TEXT NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  reason        TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 500),
  requested_by  UUID NOT NULL REFERENCES public.admin_users(admin_id),
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours',
  decided_by    UUID REFERENCES public.admin_users(admin_id),
  decided_at    TIMESTAMPTZ,
  decision      TEXT CHECK (decision IS NULL OR decision IN ('approved', 'rejected', 'cancelled', 'expired')),
  decision_note TEXT CHECK (decision_note IS NULL OR length(btrim(decision_note)) BETWEEN 1 AND 500),
  executed_at   TIMESTAMPTZ,
  -- { ok: true, data } or { ok: false, code, message } after an approved run.
  result        JSONB,
  CONSTRAINT admin_action_approvals_not_self CHECK (decided_by IS NULL OR decision = 'cancelled' OR decided_by <> requested_by),
  CONSTRAINT admin_action_approvals_decided CHECK ((decision IS NULL) = (decided_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_action_approvals_open
  ON public.admin_action_approvals (action, target_id) WHERE decision IS NULL;
CREATE INDEX IF NOT EXISTS admin_action_approvals_requested_at
  ON public.admin_action_approvals (requested_at DESC);

ALTER TABLE public.admin_action_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_action_approvals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.admin_action_approvals TO service_role;

-- ── 3. Helpers ──────────────────────────────────────────────────────────────

-- The permission an action needs, for the requester and for the approver.
CREATE OR REPLACE FUNCTION admin_approval_permission(p_action TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_action
           WHEN 'tag_reset'       THEN 'manage_nfc'
           WHEN 'tag_suspend'     THEN 'manage_nfc'
           WHEN 'account_suspend' THEN 'manage_users'
           WHEN 'account_retire'  THEN 'manage_users'
         END;
$$;

-- Requests past their 24 h are closed as expired (also run before a new
-- request, so an expired one never blocks asking again).
CREATE OR REPLACE FUNCTION admin_expire_approvals()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  UPDATE admin_action_approvals
     SET decision = 'expired', decided_at = now()
   WHERE decision IS NULL AND expires_at <= now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- ── 4. Request ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_request_approval(
  p_admin        UUID,
  p_action       TEXT,
  p_target       UUID,
  p_payload      JSONB,
  p_payload_hash TEXT,
  p_reason       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perm   TEXT := admin_approval_permission(p_action);
  v_email  TEXT;
  v_reason TEXT := btrim(coalesce(p_reason, ''));
  v_row    admin_action_approvals;
BEGIN
  IF v_perm IS NULL THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_email := admin_actor_email(p_admin, v_perm);

  IF length(v_reason) < 10 OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_target IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_action IN ('account_suspend', 'account_retire') AND p_target = p_admin THEN
    RAISE EXCEPTION 'self_action' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM admin_expire_approvals();

  BEGIN
    INSERT INTO admin_action_approvals (action, target_id, payload, payload_hash, reason, requested_by)
    VALUES (p_action, p_target, p_payload, p_payload_hash, v_reason, p_admin)
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'approval_pending' USING ERRCODE = 'unique_violation';
  END;

  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, reason, brand)
  VALUES (p_admin, v_email, 'approval_request', 'admin_approval', v_row.id,
          jsonb_build_object('approval_action', p_action, 'target_id', p_target, 'expires_at', v_row.expires_at),
          v_reason, 'auctionx');

  RETURN jsonb_build_object('id', v_row.id, 'expires_at', v_row.expires_at);
END;
$$;

-- ── 5. Decide (approve / reject / cancel) ───────────────────────────────────
-- Returns what the backend needs to run an approval. The decision commits
-- with its audit row; the backend then runs the stored payload as the
-- approver and records the result (admin_record_approval_result).
CREATE OR REPLACE FUNCTION admin_decide_approval(
  p_admin    UUID,
  p_id       UUID,
  p_decision TEXT,
  p_note     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row   admin_action_approvals;
  v_perm  TEXT;
  v_email TEXT;
  v_note  TEXT := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  IF p_decision NOT IN ('approved', 'rejected', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_row FROM admin_action_approvals WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  v_perm  := admin_approval_permission(v_row.action);
  v_email := admin_actor_email(p_admin, v_perm);

  IF v_row.decision IS NOT NULL THEN
    RAISE EXCEPTION 'approval_closed' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF v_row.expires_at <= now() THEN
    RAISE EXCEPTION 'approval_expired' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  IF p_decision = 'cancelled' THEN
    IF p_admin <> v_row.requested_by THEN
      RAISE EXCEPTION 'not_requester' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    IF p_admin = v_row.requested_by THEN
      RAISE EXCEPTION 'same_admin' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_decision = 'rejected' AND (v_note IS NULL OR length(v_note) < 10) THEN
      RAISE EXCEPTION 'reason_required' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    -- An account action never runs on the approver's own account.
    IF p_decision = 'approved' AND v_row.action IN ('account_suspend', 'account_retire') AND v_row.target_id = p_admin THEN
      RAISE EXCEPTION 'self_action' USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- A request dies with its requester's access (suspended, retired, demoted).
    IF p_decision = 'approved' AND NOT EXISTS (
      SELECT 1
        FROM admin_users a
        JOIN admin_roles r ON r.role_id = a.role_id
        JOIN users u ON u.id = a.admin_id
       WHERE a.admin_id = v_row.requested_by
         AND a.is_active
         AND u.retired_at IS NULL
         AND NOT (coalesce(u.is_suspended, false) AND (u.suspended_until IS NULL OR u.suspended_until > now()))
         AND v_perm = ANY (r.permissions::text[])
    ) THEN
      RAISE EXCEPTION 'requester_inactive' USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
  END IF;

  IF v_note IS NOT NULL AND length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE admin_action_approvals
     SET decision = p_decision, decided_by = p_admin, decided_at = now(), decision_note = v_note
   WHERE id = p_id;

  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, reason, brand)
  VALUES (p_admin, v_email,
          CASE p_decision WHEN 'approved' THEN 'approval_approve' WHEN 'rejected' THEN 'approval_reject' ELSE 'approval_cancel' END,
          'admin_approval', p_id,
          jsonb_build_object('approval_action', v_row.action, 'target_id', v_row.target_id, 'requested_by', v_row.requested_by),
          coalesce(v_note, v_row.reason), 'auctionx');

  RETURN jsonb_build_object(
    'id', v_row.id,
    'action', v_row.action,
    'target_id', v_row.target_id,
    'payload', v_row.payload,
    'payload_hash', v_row.payload_hash,
    'requested_by', v_row.requested_by,
    'decision', p_decision
  );
END;
$$;

-- ── 6. Result of an approved run ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_record_approval_result(p_id UUID, p_result JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE admin_action_approvals
     SET executed_at = now(), result = p_result
   WHERE id = p_id AND decision = 'approved' AND executed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_closed' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
END;
$$;

-- ── 7. Lockdown: service_role only (S-SEC rule for every SECURITY DEFINER) ──
REVOKE EXECUTE ON FUNCTION admin_approval_permission(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_expire_approvals() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_request_approval(UUID, TEXT, UUID, JSONB, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_decide_approval(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_record_approval_result(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_approval_permission(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION admin_expire_approvals() TO service_role;
GRANT EXECUTE ON FUNCTION admin_request_approval(UUID, TEXT, UUID, JSONB, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION admin_decide_approval(UUID, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION admin_record_approval_result(UUID, JSONB) TO service_role;
