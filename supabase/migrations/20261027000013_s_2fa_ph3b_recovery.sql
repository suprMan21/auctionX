-- =============================================================================
-- S-2FA Ph3b — email-code recovery, backup email (plan docs/plans/2026-10-27-s-2fa-ph3b.md)
-- =============================================================================
-- Boss decisions 2026-10-27: recovery by a 6-digit code emailed to the account
-- email or a verified backup email starts a 72 h hold; after it, a fresh code
-- finishes it and a 7-day freeze starts. No staff account may recover by email.
-- Old methods are kept; old backup codes are voided at finish; for the freeze,
-- an OLD method may undo the recovery. Codes go through Amazon SES only.
--
--   1. user_backup_emails       one optional backup address per account
--   2. email_codes              emailed codes (HMAC only), bound to session + nonce
--   3. account_recoveries       holding -> completed | cancelled; completed -> undone
--   4. added_by_recovery        on user_passkeys and user_totp_factors (optional columns)
--   5. CHECKs re-added with every old value: mfa_sessions.method + 'email_recovery';
--      step_up_grants.action + 'recovery_undo', 'recovery_channel'
--   6. Functions: issue_email_code, use_email_code, start_account_recovery,
--      finish_account_recovery, cancel_account_recovery, claim_recovery_enrolment,
--      release_recovery_enrolment, undo_account_recovery (ends other sessions in
--      the same transaction); triggers guard_recovery_method (passkeys, TOTP) and
--      guard_staff_recovery (admin_users) from the pre-merge security review
--   7. account_delete_blockers: these rows (and auth_change_permits) go with a deleted account
--   8. RLS on, no policies; service_role only. Every function: SECURITY DEFINER,
--      search_path public, pg_temp, EXECUTE revoked from PUBLIC, anon, authenticated
--   9. mfa-cleanup also clears old codes
--
-- Schema rules: new tables, new optional columns, CHECKs re-added as a superset,
-- account_delete_blockers replaced with a longer exclusion list. Nothing renamed
-- or retyped.
--
-- ROLLBACK: the tables and columns are unused without the Ph3b backend. To take
-- the feature out, deploy the previous backend; nothing here changes old rows.
-- =============================================================================

-- ── 1. user_backup_emails ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_backup_emails (
  user_id     UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  verified_at TIMESTAMPTZ,              -- NULL until the code sent to it is entered
  -- A replacement waiting for its code. The confirmed address keeps working until it is confirmed.
  pending_email TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_backup_emails_email_chk CHECK (
    length(email) BETWEEN 3 AND 254 AND email = lower(btrim(email)) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT user_backup_emails_pending_chk CHECK (pending_email IS NULL OR (
    length(pending_email) BETWEEN 3 AND 254 AND pending_email = lower(btrim(pending_email))
    AND pending_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'))
);

COMMENT ON TABLE public.user_backup_emails IS
  'S-2FA Ph3b: optional backup address for email-code recovery. Must differ from the account email (checked by the backend). Service role only.';

-- ── 2. email_codes ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_codes (
  id          UUID PRIMARY KEY,         -- made by the backend: it is part of the HMAC input
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_id  UUID NOT NULL,            -- Supabase session that asked for it
  nonce_hash  TEXT NOT NULL,            -- sha256 of the browser's X-Recovery-Nonce
  purpose     TEXT NOT NULL,
  channel     TEXT NOT NULL,
  code_hash   TEXT NOT NULL,            -- HMAC-SHA256(purpose|id|user|session|code); the code is never stored
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  voided_at   TIMESTAMPTZ,              -- a newer send for the same purpose voids it
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT email_codes_purpose_chk CHECK (coalesce(purpose, '') IN ('recovery_start', 'recovery_finish', 'backup_email_verify')),
  CONSTRAINT email_codes_channel_chk CHECK (coalesce(channel, '') IN ('primary', 'backup')),
  CONSTRAINT email_codes_hash_chk CHECK (code_hash ~ '^[0-9a-f]{64}$' AND nonce_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT email_codes_attempts_chk CHECK (attempts BETWEEN 0 AND 5)
);
CREATE INDEX IF NOT EXISTS email_codes_user_created_idx ON public.email_codes (user_id, created_at DESC);

COMMENT ON TABLE public.email_codes IS
  'S-2FA Ph3b: emailed 6-digit codes, HMAC only, 10 min, single use, 5 attempts, bound to session + nonce. Service role only.';

-- ── 3. account_recoveries ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.account_recoveries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  channel             TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'holding',
  started_session_id  UUID NOT NULL,
  hold_ends_at        TIMESTAMPTZ NOT NULL,
  finished_at         TIMESTAMPTZ,
  finished_session_id UUID,
  freeze_ends_at      TIMESTAMPTZ,
  -- The finishing session may add ONE passkey or authenticator app, until enrol_until.
  enrol_until         TIMESTAMPTZ,
  enrolled_at         TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  undone_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT account_recoveries_channel_chk CHECK (coalesce(channel, '') IN ('primary', 'backup')),
  CONSTRAINT account_recoveries_status_chk CHECK (coalesce(status, '') IN ('holding', 'cancelled', 'completed', 'undone')),
  CONSTRAINT account_recoveries_shape_chk CHECK (
    (status = 'holding'   AND finished_at IS NULL AND cancelled_at IS NULL AND undone_at IS NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND finished_at IS NULL)
    OR (status = 'completed' AND finished_at IS NOT NULL AND freeze_ends_at IS NOT NULL AND undone_at IS NULL)
    OR (status = 'undone'    AND finished_at IS NOT NULL AND undone_at IS NOT NULL))
);
-- At most one recovery waiting per account.
CREATE UNIQUE INDEX IF NOT EXISTS account_recoveries_one_holding_uq
  ON public.account_recoveries (user_id) WHERE status = 'holding';
CREATE INDEX IF NOT EXISTS account_recoveries_user_idx ON public.account_recoveries (user_id, created_at DESC);

COMMENT ON TABLE public.account_recoveries IS
  'S-2FA Ph3b: email-code account recovery (72 h hold, then 7-day freeze). Service role only.';

-- ── 4. added_by_recovery ────────────────────────────────────────────────────
ALTER TABLE public.user_passkeys
  ADD COLUMN IF NOT EXISTS added_by_recovery UUID REFERENCES public.account_recoveries(id) ON DELETE SET NULL;
ALTER TABLE public.user_totp_factors
  ADD COLUMN IF NOT EXISTS added_by_recovery UUID REFERENCES public.account_recoveries(id) ON DELETE SET NULL;

-- ── 5. CHECKs (superset of every old value) ─────────────────────────────────
ALTER TABLE public.mfa_sessions DROP CONSTRAINT IF EXISTS mfa_sessions_method_chk;
ALTER TABLE public.mfa_sessions ADD CONSTRAINT mfa_sessions_method_chk
  CHECK (coalesce(method, '') IN ('passkey', 'totp', 'recovery_code', 'email_recovery'));

ALTER TABLE public.step_up_grants DROP CONSTRAINT IF EXISTS step_up_grants_action_chk;
ALTER TABLE public.step_up_grants ADD CONSTRAINT step_up_grants_action_chk CHECK (coalesce(action, '') IN (
  'release', 'transfer_complete', 'price_change', 'factor_remove', 'factor_add', 'recovery_regen',
  'admin_action', 'admin_approve', 'account_change', 'recovery_undo', 'recovery_channel'));

-- ── 6. Functions ────────────────────────────────────────────────────────────

-- Stores a new code after the send limits pass, voiding older live codes of the
-- same purpose. Limits are per account, across purposes: 60 s between sends,
-- 3 an hour, 10 a day. Returns { status: ok | cooldown | hour_limit | day_limit, retry_after }.
CREATE OR REPLACE FUNCTION public.issue_email_code(
  p_id UUID, p_user UUID, p_session UUID, p_nonce_hash TEXT, p_purpose TEXT, p_channel TEXT,
  p_code_hash TEXT, p_expires_at TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_last  TIMESTAMPTZ;
  v_hour  INTEGER;
  v_day   INTEGER;
  v_first TIMESTAMPTZ;
BEGIN
  IF p_id IS NULL OR p_user IS NULL OR p_session IS NULL THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = 'check_violation';
  END IF;
  -- One sender at a time per account, so parallel sends cannot slip past the limits.
  PERFORM pg_advisory_xact_lock(hashtext('email_codes:' || p_user::text));

  SELECT max(created_at) INTO v_last FROM email_codes WHERE user_id = p_user;
  IF v_last IS NOT NULL AND v_last > now() - interval '60 seconds' THEN
    RETURN jsonb_build_object('status', 'cooldown', 'retry_after', v_last + interval '60 seconds');
  END IF;
  SELECT count(*), min(created_at) INTO v_hour, v_first
    FROM email_codes WHERE user_id = p_user AND created_at > now() - interval '1 hour';
  IF v_hour >= 3 THEN
    RETURN jsonb_build_object('status', 'hour_limit', 'retry_after', v_first + interval '1 hour');
  END IF;
  SELECT count(*), min(created_at) INTO v_day, v_first
    FROM email_codes WHERE user_id = p_user AND created_at > now() - interval '1 day';
  IF v_day >= 10 THEN
    RETURN jsonb_build_object('status', 'day_limit', 'retry_after', v_first + interval '1 day');
  END IF;

  UPDATE email_codes SET voided_at = now()
   WHERE user_id = p_user AND purpose = p_purpose AND used_at IS NULL AND voided_at IS NULL;

  INSERT INTO email_codes (id, user_id, session_id, nonce_hash, purpose, channel, code_hash, expires_at)
  VALUES (p_id, p_user, p_session, p_nonce_hash, p_purpose, p_channel, p_code_hash, p_expires_at);
  RETURN jsonb_build_object('status', 'ok', 'retry_after', now() + interval '60 seconds');
END;
$$;

-- Checks one code under a row lock. The attempt is counted before the compare.
-- A code asked for by another session or browser is refused without counting.
-- Returns { result: ok | wrong | locked | expired | invalid, channel }.
CREATE OR REPLACE FUNCTION public.use_email_code(
  p_id UUID, p_user UUID, p_session UUID, p_nonce_hash TEXT, p_purpose TEXT, p_code_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row email_codes%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM email_codes
   WHERE id = p_id AND user_id = p_user AND purpose = p_purpose
   FOR UPDATE;
  IF NOT FOUND OR v_row.session_id <> p_session OR v_row.nonce_hash <> p_nonce_hash THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;
  IF v_row.used_at IS NOT NULL OR v_row.voided_at IS NOT NULL OR v_row.expires_at <= now() THEN
    RETURN jsonb_build_object('result', 'expired');
  END IF;
  IF v_row.attempts >= 5 THEN
    RETURN jsonb_build_object('result', 'locked');
  END IF;

  UPDATE email_codes SET attempts = attempts + 1 WHERE id = p_id;
  IF v_row.code_hash = p_code_hash THEN
    UPDATE email_codes SET used_at = now() WHERE id = p_id;
    RETURN jsonb_build_object('result', 'ok', 'channel', v_row.channel);
  END IF;
  RETURN jsonb_build_object('result', CASE WHEN v_row.attempts + 1 >= 5 THEN 'locked' ELSE 'wrong' END);
END;
$$;

-- Starts the hold. Refused while another is holding or a freeze is running.
-- Returns { status: ok | busy | frozen, id, hold_ends_at }.
CREATE OR REPLACE FUNCTION public.start_account_recovery(
  p_user UUID, p_session UUID, p_channel TEXT, p_hold_hours INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id   UUID;
  v_ends TIMESTAMPTZ;
BEGIN
  IF p_hold_hours IS NULL OR p_hold_hours < 1 THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('account_recoveries:' || p_user::text));
  IF EXISTS (SELECT 1 FROM account_recoveries WHERE user_id = p_user AND status = 'holding') THEN
    RETURN jsonb_build_object('status', 'busy');
  END IF;
  IF EXISTS (SELECT 1 FROM account_recoveries
              WHERE user_id = p_user AND status = 'completed' AND freeze_ends_at > now()) THEN
    RETURN jsonb_build_object('status', 'frozen');
  END IF;
  -- Review L1: after an undo, no new recovery for 7 days (the owner changes passwords meanwhile).
  IF EXISTS (SELECT 1 FROM account_recoveries
              WHERE user_id = p_user AND status = 'undone' AND undone_at > now() - interval '7 days') THEN
    RETURN jsonb_build_object('status', 'frozen');
  END IF;
  v_ends := now() + make_interval(hours => p_hold_hours);
  INSERT INTO account_recoveries (user_id, channel, started_session_id, hold_ends_at)
  VALUES (p_user, p_channel, p_session, v_ends)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('status', 'ok', 'id', v_id, 'hold_ends_at', v_ends);
END;
$$;

-- Finishes a recovery whose hold is over, in one transaction: status completed,
-- freeze starts, old backup codes voided, this session marked verified
-- ('email_recovery', short), one enrolment allowed until p_enrol_minutes.
-- Returns { status: ok | not_ready | none, id, freeze_ends_at, enrol_until }.
CREATE OR REPLACE FUNCTION public.finish_account_recovery(
  p_user UUID, p_session UUID, p_freeze_days INTEGER, p_enrol_minutes INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row    account_recoveries%ROWTYPE;
  v_freeze TIMESTAMPTZ;
  v_enrol  TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_row FROM account_recoveries
   WHERE user_id = p_user AND status = 'holding'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;
  IF v_row.hold_ends_at > now() THEN
    RETURN jsonb_build_object('status', 'not_ready', 'hold_ends_at', v_row.hold_ends_at);
  END IF;

  v_freeze := now() + make_interval(days => p_freeze_days);
  v_enrol  := now() + make_interval(mins => p_enrol_minutes);
  UPDATE account_recoveries
     SET status = 'completed', finished_at = now(), finished_session_id = p_session,
         freeze_ends_at = v_freeze, enrol_until = v_enrol
   WHERE id = v_row.id;

  DELETE FROM user_recovery_codes WHERE user_id = p_user;

  INSERT INTO mfa_sessions (session_id, user_id, method, verified_at, expires_at)
  VALUES (p_session, p_user, 'email_recovery', now(), v_enrol)
  ON CONFLICT (session_id) DO UPDATE
    SET user_id = EXCLUDED.user_id, method = EXCLUDED.method,
        verified_at = EXCLUDED.verified_at, expires_at = EXCLUDED.expires_at
    -- Never take over a marker that belongs to another account.
    WHERE mfa_sessions.user_id = EXCLUDED.user_id;

  RETURN jsonb_build_object('status', 'ok', 'id', v_row.id, 'freeze_ends_at', v_freeze, 'enrol_until', v_enrol);
END;
$$;

-- Cancels a waiting recovery. Returns the cancelled id, or NULL when none was waiting.
CREATE OR REPLACE FUNCTION public.cancel_account_recovery(p_user UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  UPDATE account_recoveries SET status = 'cancelled', cancelled_at = now()
   WHERE user_id = p_user AND status = 'holding'
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- The finishing session's one enrolment. Returns the recovery id, or NULL when
-- this session may not enrol (wrong session, already used, window over).
CREATE OR REPLACE FUNCTION public.claim_recovery_enrolment(p_user UUID, p_session UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  UPDATE account_recoveries SET enrolled_at = now()
   WHERE user_id = p_user AND status = 'completed' AND finished_session_id = p_session
     AND enrolled_at IS NULL AND enrol_until > now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Gives the enrolment back when saving the new method failed after the claim.
CREATE OR REPLACE FUNCTION public.release_recovery_enrolment(p_user UUID, p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE account_recoveries SET enrolled_at = NULL
   WHERE id = p_id AND user_id = p_user AND status = 'completed'
     AND NOT EXISTS (SELECT 1 FROM user_passkeys WHERE added_by_recovery = p_id)
     AND NOT EXISTS (SELECT 1 FROM user_totp_factors WHERE added_by_recovery = p_id AND verified_at IS NOT NULL);
END;
$$;

-- Undoes a completed recovery during its freeze, in ONE transaction (review M1):
-- removes every method it added, and ends every other session of the account
-- (auth sessions, refresh tokens, markers, unused grants and challenges) except
-- p_keep_session, the owner's. If ending them fails, the undo rolls back. The
-- backend then makes the owner a new set of backup codes.
-- Returns { status: ok | none, passkeys_removed, totp_removed, sessions_ended }.
CREATE OR REPLACE FUNCTION public.undo_account_recovery(p_user UUID, p_id UUID, p_keep_session UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pk   INTEGER;
  v_totp INTEGER;
  v_n    INTEGER;
BEGIN
  IF p_keep_session IS NULL THEN
    RAISE EXCEPTION 'invalid_session' USING ERRCODE = 'check_violation';
  END IF;
  -- The row lock also makes a racing recovery enrolment wait, then fail (guard_recovery_method).
  UPDATE account_recoveries SET status = 'undone', undone_at = now()
   WHERE id = p_id AND user_id = p_user AND status = 'completed' AND freeze_ends_at > now();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;
  DELETE FROM user_passkeys WHERE user_id = p_user AND added_by_recovery = p_id;
  GET DIAGNOSTICS v_pk = ROW_COUNT;
  DELETE FROM user_totp_factors WHERE user_id = p_user AND added_by_recovery = p_id;
  GET DIAGNOSTICS v_totp = ROW_COUNT;
  v_n := mfa_end_other_sessions(p_user, p_keep_session);
  RETURN jsonb_build_object('status', 'ok', 'passkeys_removed', v_pk, 'totp_removed', v_totp, 'sessions_ended', v_n);
END;
$$;

-- Review M2: a method tagged added_by_recovery can only be saved while that
-- recovery is completed and frozen. FOR SHARE waits for a running undo (which
-- holds the row lock) and then sees 'undone'; an undo that starts after this
-- waits for the insert to commit and then deletes it.
CREATE OR REPLACE FUNCTION public.guard_recovery_method()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ok BOOLEAN;
BEGIN
  IF NEW.added_by_recovery IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.added_by_recovery IS NOT DISTINCT FROM OLD.added_by_recovery
     AND (to_jsonb(NEW)->>'verified_at') IS NOT DISTINCT FROM (to_jsonb(OLD)->>'verified_at') THEN
    RETURN NEW;
  END IF;
  SELECT status = 'completed' AND freeze_ends_at > now() AND user_id = NEW.user_id INTO v_ok
    FROM account_recoveries WHERE id = NEW.added_by_recovery
    FOR SHARE;
  IF NOT coalesce(v_ok, false) THEN
    RAISE EXCEPTION 'recovery_not_active' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_recovery_method ON public.user_passkeys;
CREATE TRIGGER guard_recovery_method BEFORE INSERT OR UPDATE ON public.user_passkeys
  FOR EACH ROW EXECUTE FUNCTION public.guard_recovery_method();
DROP TRIGGER IF EXISTS guard_recovery_method ON public.user_totp_factors;
CREATE TRIGGER guard_recovery_method BEFORE INSERT OR UPDATE ON public.user_totp_factors
  FOR EACH ROW EXECUTE FUNCTION public.guard_recovery_method();

-- Review L4: no staff role while a recovery is waiting or its freeze runs.
-- (Email recovery is never offered to staff; this stops a role being granted
-- or reactivated around one.) Additive: a BEFORE trigger on admin_users.
CREATE OR REPLACE FUNCTION public.guard_staff_recovery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_active AND EXISTS (
       SELECT 1 FROM account_recoveries
        WHERE user_id = NEW.admin_id
          AND (status = 'holding' OR (status = 'completed' AND freeze_ends_at > now()))) THEN
    RAISE EXCEPTION 'recovery_in_progress' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_staff_recovery ON public.admin_users;
CREATE TRIGGER guard_staff_recovery BEFORE INSERT OR UPDATE OF is_active, role_id ON public.admin_users
  FOR EACH ROW EXECUTE FUNCTION public.guard_staff_recovery();

-- ── 7. account_delete_blockers ──────────────────────────────────────────────
-- Unchanged from 20261027000006 §9 except the exclusion list: the Ph3b rows and
-- auth_change_permits (Ph2b) are the account's own disposable rows.
CREATE OR REPLACE FUNCTION account_delete_blockers(p_target UUID)
RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_u      users%ROWTYPE;
  v_email  TEXT;
  v_window INTEGER;
  v_out    TEXT[] := ARRAY[]::TEXT[];
  v_fk     RECORD;
  v_has    BOOLEAN;
BEGIN
  SELECT * INTO v_u FROM users WHERE id = p_target;
  IF NOT FOUND THEN
    RETURN ARRAY['account_not_found'];
  END IF;
  SELECT coalesce(au.email, v_u.email) INTO v_email FROM auth.users au WHERE au.id = p_target;
  v_email := coalesce(v_email, v_u.email);
  SELECT delete_window_hours INTO v_window FROM account_settings WHERE id;

  IF v_u.retired_at IS NULL THEN
    v_out := array_append(v_out, 'not_retired'::text);
  ELSIF v_u.retired_at > now() - make_interval(hours => coalesce(v_window, 24)) THEN
    v_out := array_append(v_out, 'delete_window_open'::text);
  END IF;
  -- Tokens must always have a live owner (transfer them first).
  IF EXISTS (SELECT 1 FROM nfc_tags WHERE current_owner_id = p_target) THEN
    v_out := array_append(v_out, 'owns_tokens'::text);
  END IF;
  -- nfc_tags.seller_id cascades on auth.users delete: never delete a creator.
  IF EXISTS (SELECT 1 FROM nfc_tags WHERE seller_id = p_target) THEN
    v_out := array_append(v_out, 'created_tokens'::text);
  END IF;
  IF EXISTS (SELECT 1 FROM ownership_transfers
              WHERE status = 'PENDING'
                AND (from_user_id = p_target OR to_user_id = p_target
                     OR (v_email IS NOT NULL AND lower(to_email) = lower(v_email)))) THEN
    v_out := array_append(v_out, 'pending_transfer'::text);
  END IF;
  -- Audit entries are never deleted; their actors stay retired permanently.
  IF EXISTS (SELECT 1 FROM audit_logs WHERE admin_id = p_target) THEN
    v_out := array_append(v_out, 'audit_actor'::text);
  END IF;
  -- Any other row that references the account (payments, transfers, re-issues,
  -- parked marketplace listings/bids/transactions, conversations, KYC records…)
  -- blocks Delete: those references would either cascade other people's data
  -- away or fail. Only the account's own disposable rows may go with it.
  -- Checked from the catalog, so tables added later are covered too.
  FOR v_fk IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f'
       -- admin_users.admin_id is the account id, so references to the staff row count too.
       AND c.confrelid IN ('public.users'::regclass, 'auth.users'::regclass, 'public.admin_users'::regclass)
       AND cardinality(c.conkey) = 1
       AND c.conrelid::regclass::text NOT LIKE 'auth.%'
       -- The account's own staff row (deactivated on retire) goes with it.
       AND NOT (c.conrelid = 'public.admin_users'::regclass AND c.confrelid <> 'public.admin_users'::regclass)
       AND c.conrelid::regclass::text NOT IN (
             'audit_logs',                -- reported above as audit_actor
             'nfc_tags',                  -- reported above as owns_tokens / created_tokens
             'notifications', 'notification_preferences', 'saved_searches',
             'shipping_addresses', 'transfer_voucher_grants',
             'verification_events',       -- scan history: ON DELETE SET NULL anonymises it
             'user_passkeys', 'user_totp_factors', 'user_recovery_codes',
             'mfa_challenges', 'mfa_sessions', 'step_up_grants', 'user_mfa_state',
             'auth_change_permits', 'user_backup_emails', 'email_codes', 'account_recoveries')
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', v_fk.tbl, v_fk.col) INTO v_has USING p_target;
    IF v_has THEN
      v_out := array_append(v_out, 'account_has_history'::text);
      EXIT;
    END IF;
  END LOOP;
  RETURN v_out;
END;
$$;

-- ── 8. RLS + grants ─────────────────────────────────────────────────────────
ALTER TABLE public.user_backup_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_codes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_recoveries ENABLE ROW LEVEL SECURITY;
-- No policies: anon and authenticated can never see or write these rows.
REVOKE ALL ON public.user_backup_emails, public.email_codes, public.account_recoveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_backup_emails, public.email_codes, public.account_recoveries TO service_role;

REVOKE EXECUTE ON FUNCTION public.issue_email_code(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.use_email_code(UUID, UUID, UUID, TEXT, TEXT, TEXT)                    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.start_account_recovery(UUID, UUID, TEXT, INTEGER)                    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finish_account_recovery(UUID, UUID, INTEGER, INTEGER)                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_account_recovery(UUID)                                        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_recovery_enrolment(UUID, UUID)                                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_recovery_enrolment(UUID, UUID)                               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.undo_account_recovery(UUID, UUID, UUID)                              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_recovery_method()                                              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_staff_recovery()                                               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.account_delete_blockers(UUID)                                        FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_email_code(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.use_email_code(UUID, UUID, UUID, TEXT, TEXT, TEXT)                    TO service_role;
GRANT EXECUTE ON FUNCTION public.start_account_recovery(UUID, UUID, TEXT, INTEGER)                    TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_account_recovery(UUID, UUID, INTEGER, INTEGER)                TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_account_recovery(UUID)                                        TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_recovery_enrolment(UUID, UUID)                                 TO service_role;
GRANT EXECUTE ON FUNCTION public.release_recovery_enrolment(UUID, UUID)                               TO service_role;
GRANT EXECUTE ON FUNCTION public.undo_account_recovery(UUID, UUID, UUID)                              TO service_role;
GRANT EXECUTE ON FUNCTION public.account_delete_blockers(UUID)                                        TO service_role;

-- ── 9. mfa-cleanup also clears old codes ────────────────────────────────────
-- Same job as 20261027000010 §4, one more line. Recoveries are kept (history).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mfa-cleanup') THEN
    PERFORM cron.unschedule('mfa-cleanup');
  END IF;

  PERFORM cron.schedule(
    'mfa-cleanup',
    '23 * * * *',
    $cron$
      DELETE FROM public.mfa_challenges      WHERE expires_at < now() - interval '1 day';
      DELETE FROM public.step_up_grants      WHERE expires_at < now() - interval '1 day';
      DELETE FROM public.mfa_sessions        WHERE expires_at < now();
      DELETE FROM public.auth_change_permits WHERE expires_at < now() - interval '1 day';
      DELETE FROM public.email_codes         WHERE expires_at < now() - interval '1 day';
    $cron$
  );
EXCEPTION
  WHEN undefined_table OR invalid_schema_name OR undefined_function THEN
    RAISE NOTICE 'pg_cron not present: mfa-cleanup not scheduled';
END $$;
