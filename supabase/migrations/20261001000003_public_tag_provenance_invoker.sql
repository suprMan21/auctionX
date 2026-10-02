-- Close bulk enumeration of public_tag_provenance (Supabase advisor:
-- "Security Definer View", 2026-10-01).
--
-- 20260919000002 left the view as SECURITY DEFINER (security_invoker off) and
-- granted SELECT to anon + authenticated, intending the public verify page to
-- read it. In practice its ONLY consumer is the backend
-- (ownershipController.resolveOwnershipId) using the service-role key, which
-- bypasses RLS on its own. The anon grant therefore added nothing except a hole:
-- anyone with the publishable key could `GET /rest/v1/public_tag_provenance`
-- and list EVERY tag with its current_ownership_id and disclosed origin fields,
-- bypassing the backend's lookup-by-Ownership-ID flow and its
-- `ownership.lookup` security events. Confirmed live on staging before this fix.
--
-- Now: the view runs with the caller's privileges and RLS (security_invoker),
-- and only the service role can read it. The public verify page must go through
-- the backend API, which is what the view's comment always required.
--
-- Idempotent: ALTER VIEW … SET and REVOKE are safe to re-run.

ALTER VIEW public_tag_provenance SET (security_invoker = on);

REVOKE ALL ON public_tag_provenance FROM anon, authenticated;

COMMENT ON VIEW public_tag_provenance IS
  'S-NFC3: the only permitted source for the public verify page, read ONLY by '
  'the backend (service role) — never granted to anon/authenticated. Runs as '
  'security_invoker. Never exposes prior owners, the current owner, chip UID, '
  'key material or undisclosed origin fields. Add a column here only with the '
  'disclosure gate applied.';
