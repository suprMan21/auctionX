-- S-2FA Ph3a, part 1: the permission that lets a staff role act without a
-- second admin's approval (Boss 2026-10-27: super_admin is break-glass and acts
-- alone; the daily admins approve each other's destructive actions).
--
-- A permission, not a role-name check (S-ADMIN2 one permission model). Granted
-- in 20261027000012: a new enum value cannot be used in the transaction that
-- adds it.

ALTER TYPE admin_permission ADD VALUE IF NOT EXISTS 'act_without_approval';
