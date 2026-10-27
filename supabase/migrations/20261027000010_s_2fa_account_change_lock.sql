-- =============================================================================
-- S-2FA Ph2b — password and email changes need the second factor (Option A)
-- =============================================================================
-- WHY. Our second factor lives in our own tables (mfa_sessions, step_up_grants),
-- not in Supabase's aal2. A password-only Supabase session can call GoTrue
-- `PUT /auth/v1/user` directly to change the password or start an email
-- change, skipping the second factor entirely: whoever has the password could
-- take the account over. Boss approved Option A on 2026-10-27: the database
-- refuses the change unless our backend issued a short-lived permit for it.
--
-- HOW.
--   1. public.auth_change_permits: one row per allowed change (kind 'password'
--      or 'email'), valid 2 minutes, single use. Written only by the backend
--      (service role) at POST /api/v1/auth/mfa/account-change, after a
--      verified session AND a fresh `account_change` step-up for that kind.
--   2. step_up_grants_action_chk: + 'account_change' (every old value kept).
--   3. public.guard_auth_change(): a BEFORE UPDATE trigger on auth.users. For
--      an account with a passkey or a confirmed authenticator app:
--        encrypted_password changed               -> spends a 'password' permit
--        email_change changed to a non-empty value -> spends an 'email' permit
--      No permit -> RAISE 'second_factor_required' (insufficient_privilege).
--      Accounts with no second factor are untouched (nothing to check against).
--      NOT guarded, on purpose: the final `email` swap when the user clicks the
--      confirmation link (/verify), which clears email_change to '' (the change
--      was already permitted when it was requested), and every other column.
--
-- TRIAL (rolled back on staging, 2026-10-27): role `postgres` can create a
-- trigger on auth.users; password change refused without a permit, allowed
-- with one, permit single use, email_change refused without a permit, routine
-- GoTrue writes (last_sign_in_at, raw_user_meta_data) untouched, an account
-- with no second factor unaffected. Nothing of ours writes encrypted_password
-- or email_change (no auth.admin.updateUserById anywhere in the code).
--
-- HOW A REFUSAL LOOKS TO THE CLIENT. GoTrue does not pass our message through:
-- `supabase.auth.updateUser(...)` fails with a 500 "Database error updating
-- user"-style error (GoTrue logs the underlying 'second_factor_required').
-- The frontend must therefore ask POST /auth/mfa/account-change for a permit
-- BEFORE calling updateUser, and treat that 500 as "confirm it is you again".
-- Any future staff tool that sets a password via the admin API must create a
-- permit first, or it will be refused the same way.
--
-- Trigger execution does not check EXECUTE on the function (Postgres checks it
-- only at CREATE TRIGGER), so revoking it from PUBLIC/anon/authenticated does
-- not stop GoTrue's role from firing it.
--
-- ROLLBACK (instant, no data loss):
--   DROP TRIGGER IF EXISTS guard_auth_change ON auth.users;
-- The table, function and check value can stay; without the trigger they do
-- nothing.
--
-- Schema rules: new table only; the CHECK is dropped and re-added with every
-- old value plus the new one (as 20261027000007 did). Nothing else changes.
-- =============================================================================

-- ── 1. auth_change_permits ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.auth_change_permits (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT auth_change_permits_kind_chk CHECK (kind IN ('password', 'email'))
);
CREATE INDEX IF NOT EXISTS auth_change_permits_user_kind_idx ON public.auth_change_permits (user_id, kind);

COMMENT ON TABLE public.auth_change_permits IS
  'S-2FA: single-use, 2-minute permits for a password or email change on auth.users (spent by guard_auth_change). Backend (service role) only.';

ALTER TABLE public.auth_change_permits ENABLE ROW LEVEL SECURITY;
-- No policies: anon and authenticated can never see or write a permit.
REVOKE ALL ON public.auth_change_permits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_change_permits TO service_role;

-- ── 2. step-up action ───────────────────────────────────────────────────────
ALTER TABLE public.step_up_grants DROP CONSTRAINT IF EXISTS step_up_grants_action_chk;
ALTER TABLE public.step_up_grants ADD CONSTRAINT step_up_grants_action_chk CHECK (coalesce(action, '') IN (
  'release', 'transfer_complete', 'price_change', 'factor_remove', 'factor_add', 'recovery_regen',
  'admin_action', 'admin_approve', 'account_change'));

-- ── 3. The guard ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_auth_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind TEXT;
BEGIN
  -- Only accounts that have a second factor. (A backup code alone is not one:
  -- codes exist only alongside a passkey or an authenticator app.)
  IF NOT EXISTS (SELECT 1 FROM public.user_passkeys WHERE user_id = NEW.id)
     AND NOT EXISTS (SELECT 1 FROM public.user_totp_factors WHERE user_id = NEW.id AND verified_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  IF NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password THEN
    v_kind := 'password';
  ELSIF NEW.email_change IS DISTINCT FROM OLD.email_change AND coalesce(NEW.email_change, '') <> '' THEN
    v_kind := 'email';
  ELSE
    -- Named in the SET list but unchanged, or email_change cleared at /verify.
    RETURN NEW;
  END IF;

  -- Spend exactly one live permit of this kind (oldest first).
  UPDATE public.auth_change_permits
     SET used_at = now()
   WHERE id = (
     SELECT id FROM public.auth_change_permits
      WHERE user_id = NEW.id AND kind = v_kind AND used_at IS NULL AND expires_at > now()
      ORDER BY created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
   );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'second_factor_required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_auth_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_auth_change ON auth.users;
CREATE TRIGGER guard_auth_change
  BEFORE UPDATE OF encrypted_password, email_change ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_auth_change();

-- ── 4. mfa-cleanup also clears old permits ──────────────────────────────────
-- Same job as 20261027000006 §11, one more line.
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
    $cron$
  );
EXCEPTION
  WHEN undefined_table OR invalid_schema_name OR undefined_function THEN
    RAISE NOTICE 'pg_cron not present: mfa-cleanup not scheduled';
END $$;
