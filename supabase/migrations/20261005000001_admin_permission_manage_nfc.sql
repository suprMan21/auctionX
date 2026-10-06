-- S-ADMIN1 — new admin permission for token administration.
--
-- Own migration file on purpose: a new enum value cannot be referenced in the
-- same transaction that adds it (SCHEMA_LOCK enum rules). The roles that carry
-- it are granted in 20261005000002_s_admin1_token_admin.sql.
--
-- manage_nfc gates every token-admin action: enroll + encoder precheck, tag
-- inventory/detail, suspend/unsuspend and the atomic token reset.

ALTER TYPE admin_permission ADD VALUE IF NOT EXISTS 'manage_nfc';
