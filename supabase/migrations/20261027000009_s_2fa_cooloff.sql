-- =============================================================================
-- S-2FA — 24-hour wait for a sign-in method added with a code (review M1)
-- =============================================================================
-- Boss decision 2026-10-27: a step-up for `factor_add` may be confirmed with an
-- authenticator or backup code (lost-phone recovery). So a sign-in method added
-- with a step-up that a CODE confirmed waits 24 hours before it can confirm any
-- step-up (token actions, price changes, admin actions, removing other
-- methods). It may still be used to sign in. The owner is emailed at once.
--
--   1. step_up_grants.method     how the grant was confirmed (NULL = issued
--                                before this migration; the backend treats
--                                NULL as "not a passkey")
--   2. mfa_challenges.code_confirmed
--                                set on a `register` challenge whose
--                                factor_add grant was confirmed by a code
--   3. user_passkeys.usable_from, user_totp_factors.usable_from
--                                NULL = usable now; otherwise the method may
--                                not confirm a step-up before this time
--
-- Schema rules: optional / defaulted columns only; no existing column,
-- constraint, function or value changes. mfa_challenges_shape_chk only looks at
-- purpose / action / target_id, so code_confirmed cannot conflict with it.
-- No SQL function changes (remove_mfa_factor, mfa_end_other_sessions keep
-- their grants as they are).
-- =============================================================================

-- ── 1. step_up_grants.method ────────────────────────────────────────────────
ALTER TABLE step_up_grants ADD COLUMN IF NOT EXISTS method TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'step_up_grants_method_chk') THEN
    ALTER TABLE step_up_grants ADD CONSTRAINT step_up_grants_method_chk
      CHECK (method IS NULL OR method IN ('passkey', 'totp', 'recovery_code'));
  END IF;
END $$;

COMMENT ON COLUMN step_up_grants.method IS
  'How this grant was confirmed: passkey, totp or recovery_code. NULL = issued before 20261027000009 (treated as not a passkey).';

-- ── 2. mfa_challenges.code_confirmed ────────────────────────────────────────
ALTER TABLE mfa_challenges ADD COLUMN IF NOT EXISTS code_confirmed BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN mfa_challenges.code_confirmed IS
  'register challenges only: true when the factor_add step-up was confirmed by an authenticator or backup code, so the new passkey waits 24 h (usable_from).';

-- ── 3. usable_from on the added methods ─────────────────────────────────────
ALTER TABLE user_passkeys     ADD COLUMN IF NOT EXISTS usable_from TIMESTAMPTZ;
ALTER TABLE user_totp_factors ADD COLUMN IF NOT EXISTS usable_from TIMESTAMPTZ;

COMMENT ON COLUMN user_passkeys.usable_from IS
  'NULL = usable now. Otherwise this passkey may sign in but may not confirm a step-up before this time (added with a code-confirmed step-up; S-2FA review M1, Boss 2026-10-27).';
COMMENT ON COLUMN user_totp_factors.usable_from IS
  'NULL = usable now. Otherwise this authenticator app may sign in but may not confirm a step-up before this time (added with a code-confirmed step-up; S-2FA review M1, Boss 2026-10-27).';
