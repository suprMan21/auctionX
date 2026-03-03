import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { auditLog } from '../../middleware/auditLog';

const router = Router();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getServiceClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

/**
 * POST /api/v1/admin/disputes/:settlementId/approve
 * Approve a buyer dispute — transitions DISPUTED → REFUNDED.
 * Resolution notes are written into dispute_reason for audit trail.
 * TODO: Trigger Stripe refund to buyer once Stripe Connect is configured.
 */
router.post(
  '/:settlementId/approve',
  auditLog('approve_dispute', 'settlements'),
  async (req: Request, res: Response) => {
    const { settlementId } = req.params;
    const { notes } = req.body as { notes?: string };

    if (!notes || notes.trim().length < 10) {
      res.status(400).json({ success: false, error: 'Resolution notes required (min 10 chars)' });
      return;
    }

    const supabase = getServiceClient();

    const { data: settlement, error: fetchError } = await supabase
      .from('settlements')
      .select('id, status')
      .eq('id', settlementId)
      .single();

    if (fetchError || !settlement) {
      res.status(404).json({ success: false, error: 'Settlement not found' });
      return;
    }

    if (settlement.status !== 'DISPUTED') {
      res.status(409).json({
        success: false,
        error: `Settlement is '${settlement.status}' — only DISPUTED settlements can be approved`,
      });
      return;
    }

    const now = new Date().toISOString();

    // Store admin resolution note in dispute_reason (prefixed) for audit trail.
    // A future migration can add dedicated dispute_resolution_notes column.
    const { error: updateError } = await supabase
      .from('settlements')
      .update({
        status: 'REFUNDED',
        dispute_reason: `APPROVED: ${notes.trim()}`,
        settled_at: now,
        updated_at: now,
      })
      .eq('id', settlementId);

    if (updateError) {
      console.error('approve_dispute_update_failed', { settlementId, error: updateError });
      res.status(500).json({ success: false, error: 'Failed to approve dispute' });
      return;
    }

    // TODO: Trigger Stripe refund to buyer when Stripe Connect is configured.
    // Requires: settlement → transaction_id → transactions.successful_payment_id
    // then: stripe.refunds.create({ payment_intent: processorPaymentId })

    res.json({ success: true, settlementId, status: 'REFUNDED' });
  },
);

/**
 * POST /api/v1/admin/disputes/:settlementId/reject
 * Reject a buyer dispute — transitions DISPUTED → ESCROW_HOLD.
 * Restores the settlement so release-escrow can process it normally.
 */
router.post(
  '/:settlementId/reject',
  auditLog('reject_dispute', 'settlements'),
  async (req: Request, res: Response) => {
    const { settlementId } = req.params;
    const { notes } = req.body as { notes?: string };

    if (!notes || notes.trim().length < 10) {
      res.status(400).json({ success: false, error: 'Resolution notes required (min 10 chars)' });
      return;
    }

    const supabase = getServiceClient();

    const { data: settlement, error: fetchError } = await supabase
      .from('settlements')
      .select('id, status, escrow_ends_at')
      .eq('id', settlementId)
      .single();

    if (fetchError || !settlement) {
      res.status(404).json({ success: false, error: 'Settlement not found' });
      return;
    }

    if (settlement.status !== 'DISPUTED') {
      res.status(409).json({
        success: false,
        error: `Settlement is '${settlement.status}' — only DISPUTED settlements can be rejected`,
      });
      return;
    }

    const now = new Date().toISOString();

    // If the original escrow window has already passed, set it to now so
    // release-escrow picks this settlement up on its next run.
    const restoredEscrowEnd =
      settlement.escrow_ends_at && settlement.escrow_ends_at > now
        ? settlement.escrow_ends_at
        : now;

    const { error: updateError } = await supabase
      .from('settlements')
      .update({
        status: 'ESCROW_HOLD',
        escrow_ends_at: restoredEscrowEnd,
        dispute_reason: `REJECTED: ${notes.trim()}`,
        updated_at: now,
      })
      .eq('id', settlementId);

    if (updateError) {
      console.error('reject_dispute_update_failed', { settlementId, error: updateError });
      res.status(500).json({ success: false, error: 'Failed to reject dispute' });
      return;
    }

    res.json({ success: true, settlementId, status: 'ESCROW_HOLD' });
  },
);

export default router;
