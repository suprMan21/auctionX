-- ── Module 12: Payouts + Escrow columns ────────────────────────────────────
-- Date: 2026-03-01

-- ── A. Add missing escrow columns to settlements ──────────────────────────

ALTER TABLE "public"."settlements"
  ADD COLUMN IF NOT EXISTS "escrow_ends_at"     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "escrow_released_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "dispute_reason"     TEXT,
  ADD COLUMN IF NOT EXISTS "dispute_opened_at"  TIMESTAMPTZ;

-- Partial index for release-escrow cron query
CREATE INDEX IF NOT EXISTS "idx_settlements_escrow_hold"
  ON "public"."settlements" ("escrow_ends_at")
  WHERE status = 'ESCROW_HOLD';

-- ── B. payouts table ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "public"."payouts" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "settlement_id"         UUID NOT NULL REFERENCES "public"."settlements"("id"),
  "seller_id"             UUID NOT NULL REFERENCES "public"."users"("id"),
  "gross_amount_cents"    INT NOT NULL,
  "platform_fee_cents"    INT NOT NULL,
  "processor_fee_cents"   INT NOT NULL,
  "net_payout_cents"      INT NOT NULL,
  "payout_method"         TEXT NOT NULL DEFAULT 'STRIPE_CONNECT'
    CHECK (payout_method IN ('STRIPE_CONNECT', 'BANK_TRANSFER', 'CRYPTO', 'MANUAL')),
  "payout_processor_id"   TEXT,
  "status"                TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'ON_HOLD')),
  "eligible_at"           TIMESTAMPTZ NOT NULL,
  "initiated_at"          TIMESTAMPTZ,
  "completed_at"          TIMESTAMPTZ,
  "failed_at"             TIMESTAMPTZ,
  "failure_reason"        TEXT,
  "currency"              TEXT NOT NULL DEFAULT 'CAD',
  "created_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER "set_updated_at_payouts"
  BEFORE UPDATE ON "public"."payouts"
  FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();

CREATE INDEX IF NOT EXISTS "idx_payouts_seller"     ON "public"."payouts" ("seller_id");
CREATE INDEX IF NOT EXISTS "idx_payouts_status"     ON "public"."payouts" ("status");
CREATE INDEX IF NOT EXISTS "idx_payouts_settlement" ON "public"."payouts" ("settlement_id");
CREATE INDEX IF NOT EXISTS "idx_payouts_eligible"   ON "public"."payouts" ("eligible_at")
  WHERE status = 'PENDING';

ALTER TABLE "public"."payouts" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payouts_seller_read" ON "public"."payouts"
  FOR SELECT USING (seller_id = auth.uid());

GRANT ALL ON TABLE "public"."payouts" TO "anon";
GRANT ALL ON TABLE "public"."payouts" TO "authenticated";
GRANT ALL ON TABLE "public"."payouts" TO "service_role";
