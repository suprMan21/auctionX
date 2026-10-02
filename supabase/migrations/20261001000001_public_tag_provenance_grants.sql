-- S-DB1 — tighten grants on public_tag_provenance to SELECT only.
--
-- 20260919000002 revoked the blanket default grants on its two new tables but
-- not on the view, so anon + authenticated inherited REFERENCES, TRIGGER and
-- TRUNCATE from `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO anon`
-- (20260201042342:2411) — the mechanism behind the S-ISO1 aes_key_enc exposure.
-- Found live on staging 2026-10-01. Not exploitable today (the view is not
-- updatable and TRUNCATE on a view errors), but SELECT is the only privilege
-- the public verify page needs.
--
-- Idempotent: REVOKE/GRANT are safe to re-run.

REVOKE ALL    ON public_tag_provenance FROM anon, authenticated;
GRANT  SELECT ON public_tag_provenance TO   anon, authenticated;
