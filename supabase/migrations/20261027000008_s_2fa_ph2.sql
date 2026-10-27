-- =============================================================================
-- S-2FA Ph2 — end the account's other sessions when a sign-in method changes
-- =============================================================================
-- Boss decision 2026-10-27: adding or removing a passkey / authenticator app, or
-- making new backup codes, signs the account out everywhere else. The session
-- that made the change stays signed in.
--
--   1. mfa_end_other_sessions(p_user, p_keep_session)
--        - auth.sessions of p_user except p_keep_session
--        - auth.refresh_tokens of p_user except those of p_keep_session
--          (refresh_tokens.user_id is TEXT; rows with no session_id are
--          pre-session-era tokens and go too)
--        - mfa_sessions markers and unused step_up_grants / mfa_challenges of
--          the other sessions (belt and braces: a deleted Supabase session is
--          already refused by GoTrue getUser in requireAuth / verifyAdminAuth)
--      Returns the number of auth.sessions ended.
--      admin_users.session_version is NOT bumped (unlike admin_end_sessions):
--      that would also end the caller's own admin token.
--
-- audit_logs has no CHECK on action or entity_type, so the new staff actions
-- (mfa_factor_add, mfa_factor_remove, mfa_recovery_regen, mfa_lockout) need no
-- schema change. No existing column, constraint or value changes here.
-- =============================================================================

CREATE OR REPLACE FUNCTION mfa_end_other_sessions(p_user UUID, p_keep_session UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  -- Never "end everything" by accident: the caller's own session must be named.
  IF p_user IS NULL OR p_keep_session IS NULL THEN
    RAISE EXCEPTION 'invalid_session' USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM auth.sessions WHERE user_id = p_user AND id <> p_keep_session;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  DELETE FROM auth.refresh_tokens
   WHERE user_id = p_user::text
     AND (session_id IS NULL OR session_id <> p_keep_session);

  DELETE FROM public.mfa_sessions   WHERE user_id = p_user AND session_id <> p_keep_session;
  DELETE FROM public.step_up_grants WHERE user_id = p_user AND session_id <> p_keep_session AND used_at IS NULL;
  DELETE FROM public.mfa_challenges WHERE user_id = p_user AND session_id <> p_keep_session AND used_at IS NULL;

  RETURN v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION mfa_end_other_sessions(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION mfa_end_other_sessions(UUID, UUID) TO service_role;
