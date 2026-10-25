-- S-ADMIN2 Ph1 (2026-10-25): permissions that replace role-NAME checks.
--
-- Pricing, vouchers and the stuck-payment queue were gated on role names
-- because the seeded `support` role carries `process_refunds` from the parked
-- marketplace. These three permissions let every admin gate be a permission
-- check (AC 9). They are granted to roles in 20261025000003: a new enum value
-- cannot be used in the transaction that adds it.

ALTER TYPE admin_permission ADD VALUE IF NOT EXISTS 'reapply_payments';
ALTER TYPE admin_permission ADD VALUE IF NOT EXISTS 'refund_token_fees';
ALTER TYPE admin_permission ADD VALUE IF NOT EXISTS 'manage_pricing';
