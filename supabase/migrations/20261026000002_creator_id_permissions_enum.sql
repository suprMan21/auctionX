-- Creator ID checks access (Boss 2026-10-26).
--
-- Creator ID checks (Yoti) were gated on `review_sellers`, which also allows
-- changing a creator's verification status and approving sellers on the parked
-- marketplace. Admin and Support need to OPEN the checks, and only Admin and
-- Super admin may change a status, so two narrower permissions replace it on
-- those routes. `review_sellers` stays super_admin-only for the parked
-- marketplace. Granted to roles in 20261026000003: a new enum value cannot be
-- used in the transaction that adds it.

ALTER TYPE admin_permission ADD VALUE IF NOT EXISTS 'view_creator_ids';
ALTER TYPE admin_permission ADD VALUE IF NOT EXISTS 'manage_creator_ids';
