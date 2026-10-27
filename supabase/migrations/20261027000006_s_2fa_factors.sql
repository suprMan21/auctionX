-- =============================================================================
-- S-2FA Ph1 — second factors (passkeys, authenticator app, recovery codes),
-- per-session "second factor done" marker, single-use step-up grants.
-- =============================================================================
-- Built in-house (Boss, 2026-10-27): Supabase's WebAuthn MFA is experimental and
-- AWS Cognito only offers passkeys as a whole sign-in system. The backend checks
-- passkeys with @simplewebauthn/server; the database only stores public keys,
-- an encrypted TOTP secret, hashed recovery codes and short-lived rows.
--
--   1. user_passkeys         public keys only (never a private key)
--   2. user_totp_factors     one authenticator app per account, secret encrypted by the backend
--   3. user_recovery_codes   HMAC hashes, single use
--   4. mfa_challenges        passkey challenges, single use, 5 minutes
--   5. mfa_sessions          "second factor done" for one Supabase session_id
--   6. step_up_grants        single-use grant for one action on one target, 2 minutes
--   7. user_mfa_state        wrong-code lockout (5 tries, then 15 minutes)
--   8. replace_recovery_codes / record_mfa_failure (atomic)
--   9. account_delete_blockers: these rows go with a deleted account
--  10. RLS on, no policies; service_role only
--  11. mfa-cleanup: pg_cron, hourly
--
-- Schema rules: new tables only; no existing column changed.
-- =============================================================================

-- ── 1. user_passkeys ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_passkeys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL,
  public_key    TEXT NOT NULL,          -- base64url COSE public key
  sign_count    BIGINT NOT NULL DEFAULT 0,
  transports    TEXT[] NOT NULL DEFAULT '{}',
  aaguid        TEXT,
  -- true = synced passkey (iCloud Keychain, Google Password Manager). A
  -- super_admin may only use device-bound keys (false), i.e. a hardware key.
  backed_up     BOOLEAN NOT NULL DEFAULT false,
  nickname      TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  CONSTRAINT user_passkeys_credential_uq UNIQUE (credential_id),
  CONSTRAINT user_passkeys_credential_chk CHECK (credential_id ~ '^[A-Za-z0-9_-]+$' AND length(credential_id) BETWEEN 16 AND 1024),
  CONSTRAINT user_passkeys_nickname_chk CHECK (length(btrim(coalesce(nickname, ''))) BETWEEN 1 AND 40),
  CONSTRAINT user_passkeys_count_chk CHECK (sign_count >= 0)
);
CREATE INDEX IF NOT EXISTS user_passkeys_user_idx ON user_passkeys (user_id);

-- ── 2. user_totp_factors ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_totp_factors (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- v1.<iv>.<tag>.<ciphertext>, AES-256-GCM under MFA_SECRET_KEY, bound to user_id.
  secret_enc     TEXT NOT NULL,
  verified_at    TIMESTAMPTZ,           -- NULL until the first code confirms setup
  last_used_step BIGINT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_totp_secret_chk CHECK (secret_enc LIKE 'v1.%')
);

-- ── 3. user_recovery_codes ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_recovery_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,             -- hex HMAC-SHA256(MFA_RECOVERY_PEPPER, user_id:code)
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_recovery_codes_uq UNIQUE (user_id, code_hash),
  CONSTRAINT user_recovery_codes_hash_chk CHECK (code_hash ~ '^[0-9a-f]{64}$')
);

-- ── 4. mfa_challenges ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mfa_challenges (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  purpose    TEXT NOT NULL,
  challenge  TEXT NOT NULL,
  action     TEXT,
  target_id  TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mfa_challenges_purpose_chk CHECK (coalesce(purpose, '') IN ('register', 'sign_in', 'step_up')),
  -- A step-up challenge always names its action and target; the others never do.
  CONSTRAINT mfa_challenges_shape_chk CHECK (
    (purpose = 'step_up' AND action IS NOT NULL AND target_id IS NOT NULL)
    OR (purpose <> 'step_up' AND action IS NULL AND target_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS mfa_challenges_expiry_idx ON mfa_challenges (expires_at);

-- ── 5. mfa_sessions ─────────────────────────────────────────────────────────
-- session_id is the Supabase JWT `session_id` claim. Sign-out, suspend, retire
-- and role change end the Supabase session, and a new sign-in gets a new
-- session_id, so a marker can never carry over.
CREATE TABLE IF NOT EXISTS mfa_sessions (
  session_id  UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method      TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  CONSTRAINT mfa_sessions_method_chk CHECK (coalesce(method, '') IN ('passkey', 'totp', 'recovery_code'))
);
CREATE INDEX IF NOT EXISTS mfa_sessions_user_idx ON mfa_sessions (user_id);

-- ── 6. step_up_grants ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS step_up_grants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL,             -- hex SHA-256 of a random 32-byte token
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  action     TEXT NOT NULL,
  target_id  TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT step_up_grants_hash_uq UNIQUE (token_hash),
  CONSTRAINT step_up_grants_hash_chk CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT step_up_grants_action_chk CHECK (coalesce(action, '') IN (
    'release', 'transfer_complete', 'price_change', 'factor_remove', 'admin_action', 'admin_approve'))
);

-- ── 7. user_mfa_state ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_mfa_state (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_mfa_state_attempts_chk CHECK (failed_attempts >= 0)
);

-- ── 8. Atomic functions ─────────────────────────────────────────────────────

-- Swaps the whole recovery-code set in one transaction: the old set is never
-- left half-replaced, and there are never two live sets.
CREATE OR REPLACE FUNCTION replace_recovery_codes(p_user UUID, p_hashes TEXT[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_user IS NULL OR coalesce(cardinality(p_hashes), 0) <> 10 THEN
    RAISE EXCEPTION 'invalid_recovery_codes' USING ERRCODE = 'check_violation';
  END IF;
  DELETE FROM user_recovery_codes WHERE user_id = p_user;
  INSERT INTO user_recovery_codes (user_id, code_hash)
  SELECT p_user, h FROM unnest(p_hashes) AS h;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- One wrong code. The 5th inside the window locks the account's code entry for
-- 15 minutes. Returns the lock end (NULL while not locked). Row lock makes
-- concurrent wrong guesses count one by one.
CREATE OR REPLACE FUNCTION record_mfa_failure(p_user UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state user_mfa_state%ROWTYPE;
BEGIN
  INSERT INTO user_mfa_state (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_state FROM user_mfa_state WHERE user_id = p_user FOR UPDATE;

  -- A lock that has run out starts a fresh count.
  IF v_state.locked_until IS NOT NULL AND v_state.locked_until <= now() THEN
    v_state.failed_attempts := 0;
    v_state.locked_until := NULL;
  END IF;

  v_state.failed_attempts := v_state.failed_attempts + 1;
  IF v_state.failed_attempts >= 5 AND v_state.locked_until IS NULL THEN
    v_state.locked_until := now() + interval '15 minutes';
  END IF;

  UPDATE user_mfa_state
     SET failed_attempts = v_state.failed_attempts,
         locked_until    = v_state.locked_until,
         updated_at      = now()
   WHERE user_id = p_user;
  RETURN v_state.locked_until;
END;
$$;

-- ── 9. account_delete_blockers ─────────────────────────────────────────────
-- Unchanged from 20261025000003 except the exclusion list: second-factor rows
-- are the account's own disposable rows and go with it (ON DELETE CASCADE).
-- Without this, every account with a passkey would read as account_has_history.
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
             'mfa_challenges', 'mfa_sessions', 'step_up_grants', 'user_mfa_state')
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

-- ── 10. RLS + grants ────────────────────────────────────────────────────────
ALTER TABLE user_passkeys       ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_totp_factors   ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_challenges      ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE step_up_grants      ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_mfa_state      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON user_passkeys, user_totp_factors, user_recovery_codes, mfa_challenges,
              mfa_sessions, step_up_grants, user_mfa_state
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_passkeys, user_totp_factors, user_recovery_codes,
              mfa_challenges, mfa_sessions, step_up_grants, user_mfa_state
  TO service_role;

REVOKE EXECUTE ON FUNCTION replace_recovery_codes(UUID, TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION record_mfa_failure(UUID)              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION account_delete_blockers(UUID)         FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION replace_recovery_codes(UUID, TEXT[]) TO service_role;
GRANT  EXECUTE ON FUNCTION record_mfa_failure(UUID)              TO service_role;
GRANT  EXECUTE ON FUNCTION account_delete_blockers(UUID)         TO service_role;

-- ── 11. mfa-cleanup: hourly ─────────────────────────────────────────────────
-- Expired challenges, grants and markers are useless; used ones are kept for a
-- day for support questions, then go.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mfa-cleanup') THEN
    PERFORM cron.unschedule('mfa-cleanup');
  END IF;

  PERFORM cron.schedule(
    'mfa-cleanup',
    '23 * * * *',
    $cron$
      DELETE FROM public.mfa_challenges WHERE expires_at < now() - interval '1 day';
      DELETE FROM public.step_up_grants WHERE expires_at < now() - interval '1 day';
      DELETE FROM public.mfa_sessions   WHERE expires_at < now();
    $cron$
  );
EXCEPTION
  WHEN undefined_table OR invalid_schema_name OR undefined_function THEN
    RAISE NOTICE 'pg_cron not present: mfa-cleanup not scheduled';
END $$;
