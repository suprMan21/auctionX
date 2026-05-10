-- Phase 7B: buyer-confirmed delivery as an escrow-release trigger.
--
-- Adds two nullable columns to settlements. When delivery_confirmed_at is set,
-- release-escrow treats the settlement as eligible for payout regardless of
-- whether the 72h escrow_ends_at window has elapsed.
--
-- Authorisation is enforced by the backend confirmDelivery handler, which
-- runs under the service-role client and verifies the caller is the buyer
-- and the settlement status is ESCROW_HOLD. The partial index keeps the
-- release-escrow OR-filter query cheap.

ALTER TABLE "public"."settlements"
  ADD COLUMN IF NOT EXISTS "delivery_confirmed_at" TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS "delivery_confirmed_by" UUID NULL REFERENCES "public"."users"("id");

CREATE INDEX IF NOT EXISTS "idx_settlements_delivery_confirmed"
  ON "public"."settlements" ("delivery_confirmed_at")
  WHERE "delivery_confirmed_at" IS NOT NULL;

COMMENT ON COLUMN "public"."settlements"."delivery_confirmed_at" IS
  'Timestamp at which the buyer confirmed receipt of the item. When set, '
  'release-escrow treats the settlement as eligible for payout immediately, '
  'bypassing the 72h escrow_ends_at hold.';

COMMENT ON COLUMN "public"."settlements"."delivery_confirmed_by" IS
  'User who confirmed delivery — must equal settlements.buyer_id at the time '
  'of confirmation. Recorded for audit, not enforced via FK constraint.';
