-- S-SEC hotfix (2026-10-25): close three holes found while scoping S-ADMIN2.
--
-- 1. Eleven SECURITY DEFINER functions were callable by anon/authenticated
--    through /rest/v1/rpc with no permission check (Postgres grants EXECUTE to
--    PUBLIC by default). Anyone holding the public key could deactivate an
--    admin, suspend or ban any user, or apply payment penalties. Only the
--    backend and Edge Functions call them, with the service key.
--    is_active_admin / is_admin_with_permission stay callable: RLS policies
--    evaluate them as the caller.
--
-- 2. Policy "Anyone can view users" (USING true) let the public key read every
--    column of every user: email, phone, role, Stripe and Yoti ids. Replaced by
--    "own row" plus "staff with view_users". anon keeps the bare SELECT
--    privilege (other tables' policies subquery users; without the privilege
--    those queries would error instead of returning no rows) but no policy, so
--    it sees nothing.
--
-- 3. Users could UPDATE every column of their own row except role and
--    seller_tier: email (used to match email-addressed transfers), is_suspended,
--    is_banned, age_verified, seller_verification_status, billing_country...
--    Narrowed to the profile fields the app edits. The transfer recipient check
--    now also uses the confirmed Supabase Auth email (backend change, same commit).
--
-- Live checks: supabase/tests/s_sec_hotfix_lockdown_live.sql

-- ── 1. Functions: service_role only ──────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.suspend_user(uuid, integer, text, uuid)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.unsuspend_user(uuid, uuid)                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ban_user(uuid, text, uuid)                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.unban_user(uuid, uuid)                    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.deactivate_admin(uuid, text)              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reactivate_admin(uuid)                    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_admin_session(uuid)                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_payment_penalty(uuid, uuid, uuid)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_next_eligible_bidder(uuid, uuid[])    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.calculate_processor_success_rate(payment_processor, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_token_name(uuid)                 FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.suspend_user(uuid, integer, text, uuid)   TO service_role;
GRANT EXECUTE ON FUNCTION public.unsuspend_user(uuid, uuid)                TO service_role;
GRANT EXECUTE ON FUNCTION public.ban_user(uuid, text, uuid)                TO service_role;
GRANT EXECUTE ON FUNCTION public.unban_user(uuid, uuid)                    TO service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_admin(uuid, text)              TO service_role;
GRANT EXECUTE ON FUNCTION public.reactivate_admin(uuid)                    TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_admin_session(uuid)                TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_payment_penalty(uuid, uuid, uuid)   TO service_role;
GRANT EXECUTE ON FUNCTION public.get_next_eligible_bidder(uuid, uuid[])    TO service_role;
GRANT EXECUTE ON FUNCTION public.calculate_processor_success_rate(payment_processor, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_token_name(uuid)                 TO service_role;

-- ── 2. users: who can read which rows ────────────────────────────────────────
-- auth.uid() is called directly, not as (SELECT auth.uid()): the self-update
-- policy subqueries users, and a sub-select inside these policies would make
-- Postgres report infinite recursion (42P17) on every UPDATE of users.
DROP POLICY IF EXISTS "Anyone can view users" ON public.users;
DROP POLICY IF EXISTS users_select_own   ON public.users;
DROP POLICY IF EXISTS users_select_staff ON public.users;

CREATE POLICY users_select_own ON public.users
  FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY users_select_staff ON public.users
  FOR SELECT TO authenticated
  USING (public.is_admin_with_permission(auth.uid(), 'view_users'));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.users FROM anon;

-- ── 3. users: which columns a user may change on their own row ───────────────
REVOKE UPDATE ON public.users FROM authenticated;
GRANT UPDATE (display_name, phone_number, photo_url, profile_photo_url, bio, preferred_brand, updated_at)
  ON public.users TO authenticated;
