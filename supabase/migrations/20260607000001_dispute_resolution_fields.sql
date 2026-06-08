-- S25 (Phase 7F) — Dispute Resolution Full Flow.
--
-- Adds the columns the admin dispute resolution flow needs:
--   - buyer-submitted evidence URLs (multi-file S3 uploads)
--   - admin resolution choice (full refund / partial refund / rejected / appealed)
--   - partial-refund amount (for the PARTIAL_REFUND path)
--   - dedicated resolution_notes column (replaces the dispute_reason overload
--     where Phase 3.75 prefixed "APPROVED:" / "REJECTED:" into a single field)
--   - processor refund ID (for reconciliation against Stripe Dashboard refunds)
--   - 7-day appeal window after rejection (deadline + opened-at + reason)
--
-- Schema-lock posture: extension-only. All columns optional / nullable; no
-- existing fields removed, renamed, or retyped. The CHECK constraint on
-- resolution_action serves as a soft enum without the
-- "add-enum-value-and-reference-in-same-migration" hazard (Every-Session lesson).
--
-- Companion code changes (this session):
--   - backend/src/routes/admin/disputes.ts — extended approve route with
--     action=FULL_REFUND|PARTIAL_REFUND + partial_amount_cents; rejected
--     settlements set appeal_deadline = now + 7d.
--   - backend/src/controllers/payoutController.ts — openDispute accepts
--     evidence_urls?: string[]; calls notificationService.
--   - backend/src/routes/settlements.ts — new POST /:id/dispute/evidence
--     (presigned S3 PUT) + POST /:id/dispute/appeal.
--   - backend/src/lib/refundClient.ts — Stripe refund wrapper.
--   - backend/src/lib/notifications/emailTemplates.ts — 4 new dispute templates.

ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS evidence_urls               TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS resolution_action           TEXT,
  ADD COLUMN IF NOT EXISTS partial_refund_amount_cents BIGINT,
  ADD COLUMN IF NOT EXISTS dispute_resolution_notes    TEXT,
  ADD COLUMN IF NOT EXISTS processor_refund_id         TEXT,
  ADD COLUMN IF NOT EXISTS appeal_deadline             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS appeal_opened_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS appeal_reason               TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'settlements_resolution_action_valid'
  ) THEN
    ALTER TABLE settlements
      ADD CONSTRAINT settlements_resolution_action_valid
      CHECK (
        resolution_action IS NULL
        OR resolution_action IN ('FULL_REFUND', 'PARTIAL_REFUND', 'REJECTED', 'APPEALED')
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'settlements_partial_refund_amount_positive'
  ) THEN
    ALTER TABLE settlements
      ADD CONSTRAINT settlements_partial_refund_amount_positive
      CHECK (
        partial_refund_amount_cents IS NULL
        OR partial_refund_amount_cents > 0
      );
  END IF;
END $$;

-- Admin queue index: DISPUTED settlements sorted by oldest dispute first.
CREATE INDEX IF NOT EXISTS settlements_dispute_queue_idx
  ON settlements (dispute_opened_at)
  WHERE status = 'DISPUTED';

COMMENT ON COLUMN settlements.evidence_urls IS
  'Array of S3 URLs for buyer-submitted dispute evidence (images/videos/docs)';
COMMENT ON COLUMN settlements.resolution_action IS
  'Admin resolution action: FULL_REFUND | PARTIAL_REFUND | REJECTED | APPEALED. NULL until DISPUTED→resolved transition.';
COMMENT ON COLUMN settlements.partial_refund_amount_cents IS
  'Amount actually refunded when resolution_action = PARTIAL_REFUND. Null otherwise.';
COMMENT ON COLUMN settlements.dispute_resolution_notes IS
  'Free-text admin notes captured at resolution time. Replaces the old "APPROVED:/REJECTED:" prefixed dispute_reason overload.';
COMMENT ON COLUMN settlements.processor_refund_id IS
  'Refund ID from the payment processor (e.g., Stripe re_xxx) for reconciliation. Null until refund executes.';
COMMENT ON COLUMN settlements.appeal_deadline IS
  '7 days after a rejected dispute. Buyer can POST /:id/dispute/appeal until this timestamp.';
