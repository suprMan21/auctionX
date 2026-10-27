-- =============================================================================
-- S-2FA Ph1 — security review fixes (2026-10-27)
-- =============================================================================
--   1. step_up_grants: two more actions. Adding a sign-in method (`factor_add`)
--      and making new backup codes (`recovery_regen`) now need a fresh check,
--      so a stolen session cannot plant its own passkey.
--   2. Code attempts are counted BEFORE the code is checked, in one locked
--      statement (begin_mfa_code_attempt), so a parallel burst cannot get more
--      than 5 tries per window. Repeat locks grow: 15 min, 1 h, 4 h, then 24 h.
--      record_mfa_failure (Ph1, never deployed) is dropped.
--   3. remove_mfa_factor: the last-factor rule and the delete run under one row
--      lock, so two concurrent removals cannot leave an account with none.
-- New tables from 20261027000006 only; nothing else changes.
-- =============================================================================

-- ── 1. More step-up actions ─────────────────────────────────────────────────
ALTER TABLE step_up_grants DROP CONSTRAINT IF EXISTS step_up_grants_action_chk;
ALTER TABLE step_up_grants ADD CONSTRAINT step_up_grants_action_chk CHECK (coalesce(action, '') IN (
  'release', 'transfer_complete', 'price_change', 'factor_remove', 'factor_add', 'recovery_regen',
  'admin_action', 'admin_approve'));

-- ── 2. Counted-before-checked code attempts ─────────────────────────────────
ALTER TABLE user_mfa_state ADD COLUMN IF NOT EXISTS lock_count INTEGER NOT NULL DEFAULT 0;
DO $$
BEGIN
  ALTER TABLE user_mfa_state ADD CONSTRAINT user_mfa_state_lock_count_chk CHECK (lock_count >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP FUNCTION IF EXISTS record_mfa_failure(UUID);

-- Call before checking a code. Returns {locked_until, newly_locked}:
--   locked_until NULL  → go ahead (this attempt is already counted)
--   locked_until set   → refuse without checking the code
-- A right code then calls clear (user_mfa_state back to 0 / 0).
CREATE OR REPLACE FUNCTION begin_mfa_code_attempt(p_user UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state user_mfa_state%ROWTYPE;
  v_until TIMESTAMPTZ;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'invalid_user' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO user_mfa_state (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_state FROM user_mfa_state WHERE user_id = p_user FOR UPDATE;

  IF v_state.locked_until IS NOT NULL AND v_state.locked_until > now() THEN
    RETURN jsonb_build_object('locked_until', v_state.locked_until, 'newly_locked', false);
  END IF;

  -- 5 unconfirmed attempts already used: lock. 15 min × 4^(earlier locks), at most 24 h.
  IF v_state.failed_attempts >= 5 THEN
    v_until := now() + least(interval '15 minutes' * power(4, least(v_state.lock_count, 4)), interval '24 hours');
    UPDATE user_mfa_state
       SET failed_attempts = 0, locked_until = v_until, lock_count = lock_count + 1, updated_at = now()
     WHERE user_id = p_user;
    RETURN jsonb_build_object('locked_until', v_until, 'newly_locked', true);
  END IF;

  UPDATE user_mfa_state
     SET failed_attempts = failed_attempts + 1, locked_until = NULL, updated_at = now()
   WHERE user_id = p_user;
  RETURN jsonb_build_object('locked_until', NULL, 'newly_locked', false);
END;
$$;

-- ── 3. Remove a factor, never the last one ──────────────────────────────────
-- p_kind: 'passkey' (p_id required) or 'totp'. p_break_glass: only hardware
-- keys (backed_up = false) count, and the authenticator app never does.
-- Returns 'removed' | 'not_found' | 'last_factor'.
CREATE OR REPLACE FUNCTION remove_mfa_factor(p_user UUID, p_kind TEXT, p_id UUID, p_break_glass BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total  INTEGER;
  v_target BOOLEAN;
BEGIN
  IF p_user IS NULL OR coalesce(p_kind, '') NOT IN ('passkey', 'totp') OR (p_kind = 'passkey' AND p_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_factor' USING ERRCODE = 'check_violation';
  END IF;
  -- One lock per account serialises every removal for it.
  INSERT INTO user_mfa_state (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM user_mfa_state WHERE user_id = p_user FOR UPDATE;

  SELECT count(*) INTO v_total FROM user_passkeys
   WHERE user_id = p_user AND (NOT coalesce(p_break_glass, false) OR backed_up = false);
  IF NOT coalesce(p_break_glass, false) THEN
    v_total := v_total + (SELECT count(*) FROM user_totp_factors WHERE user_id = p_user AND verified_at IS NOT NULL);
  END IF;

  IF p_kind = 'passkey' THEN
    SELECT EXISTS (SELECT 1 FROM user_passkeys WHERE id = p_id AND user_id = p_user) INTO v_target;
    IF NOT v_target THEN RETURN 'not_found'; END IF;
    -- A synced passkey on a break-glass account does not count, so removing it never hits the floor.
    IF (NOT coalesce(p_break_glass, false) OR EXISTS (SELECT 1 FROM user_passkeys WHERE id = p_id AND backed_up = false))
       AND v_total <= 1 THEN
      RETURN 'last_factor';
    END IF;
    DELETE FROM user_passkeys WHERE id = p_id AND user_id = p_user;
  ELSE
    SELECT EXISTS (SELECT 1 FROM user_totp_factors WHERE user_id = p_user AND verified_at IS NOT NULL) INTO v_target;
    IF NOT v_target THEN RETURN 'not_found'; END IF;
    IF NOT coalesce(p_break_glass, false) AND v_total <= 1 THEN
      RETURN 'last_factor';
    END IF;
    DELETE FROM user_totp_factors WHERE user_id = p_user;
  END IF;
  RETURN 'removed';
END;
$$;

REVOKE EXECUTE ON FUNCTION begin_mfa_code_attempt(UUID)                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION remove_mfa_factor(UUID, TEXT, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION begin_mfa_code_attempt(UUID)                 TO service_role;
GRANT  EXECUTE ON FUNCTION remove_mfa_factor(UUID, TEXT, UUID, BOOLEAN) TO service_role;
