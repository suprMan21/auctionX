-- S-NFC3-FE Ph2 live fix (2026-10-03).
--
-- ownership_transfers_target_chk required a PENDING transfer to name EXACTLY
-- one of to_user_id / to_email. But an email-targeted transfer resolves its
-- recipient on the first /complete attempt by setting to_user_id while
-- to_email is still set, which violated the check. The UPDATE failed silently,
-- the PaymentIntent was still created, and the webhook then refused to apply a
-- paid transfer ("no recipient"). Every email transfer was uncompletable.
--
-- "Exactly one" is still enforced at initiate time by the API's Zod schema.
-- The database now requires AT LEAST one target while PENDING, so the resolved
-- recipient can sit alongside the original email (kept for the audit trail).

ALTER TABLE ownership_transfers DROP CONSTRAINT IF EXISTS ownership_transfers_target_chk;

ALTER TABLE ownership_transfers
  ADD CONSTRAINT ownership_transfers_target_chk
  CHECK (
    status IS NULL
    OR (status = 'PENDING'   AND (to_user_id IS NOT NULL OR to_email IS NOT NULL))
    OR (status = 'COMPLETED' AND to_user_id IS NOT NULL)
    OR status = 'CANCELLED'
  );
