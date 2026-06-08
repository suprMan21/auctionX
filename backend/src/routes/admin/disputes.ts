import { Router, Request, Response } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { auditLog } from '../../middleware/auditLog';
import { refundSettlement } from '../../lib/refundClient';
import { notificationService } from '../../lib/notifications/notificationService';

const router = Router();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getServiceClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

interface SettlementRow {
  id: string;
  status: string;
  buyer_id: string | null;
  seller_id: string | null;
  gross_amount_cents: number;
  transaction_id: string | null;
  escrow_ends_at: string | null;
}

async function loadDisputedSettlement(
  supabase: SupabaseClient,
  settlementId: string,
): Promise<{ settlement: SettlementRow | null; reason?: string }> {
  const { data, error } = await supabase
    .from('settlements')
    .select('id, status, buyer_id, seller_id, gross_amount_cents, transaction_id, escrow_ends_at')
    .eq('id', settlementId)
    .maybeSingle();

  if (error || !data) return { settlement: null, reason: 'Settlement not found' };
  if (data.status !== 'DISPUTED') {
    return {
      settlement: null,
      reason: `Settlement is '${data.status}' — only DISPUTED settlements can be acted on`,
    };
  }
  return { settlement: data as SettlementRow };
}

function frontendBase(): string {
  return process.env.FRONTEND_URL || 'http://localhost:5173';
}

function getAdminId(req: Request): string | null {
  const user = (req as Request & { user?: { id?: string } }).user;
  return user?.id ?? null;
}

/**
 * POST /api/v1/admin/disputes/:settlementId/approve
 * Resolve a DISPUTED settlement in favor of the buyer.
 * Body: {
 *   action: 'FULL_REFUND' | 'PARTIAL_REFUND',
 *   partial_amount_cents?: number,  // required when action = PARTIAL_REFUND
 *   notes: string                   // admin resolution notes, min 10 chars
 * }
 *
 * On success: status → REFUNDED, Stripe refund is created, both parties notified.
 * On refund failure: state is NOT changed; admin can retry.
 */
router.post(
  '/:settlementId/approve',
  auditLog('approve_dispute', 'settlements'),
  async (req: Request, res: Response) => {
    const settlementId = req.params['settlementId'] as string;
    const { action, partial_amount_cents, notes } = req.body as {
      action?: 'FULL_REFUND' | 'PARTIAL_REFUND';
      partial_amount_cents?: number;
      notes?: string;
    };
    const adminId = getAdminId(req);

    if (!adminId) {
      res.status(401).json({ success: false, error: 'Admin authentication required' });
      return;
    }
    if (action !== 'FULL_REFUND' && action !== 'PARTIAL_REFUND') {
      res.status(400).json({
        success: false,
        error: "action must be 'FULL_REFUND' or 'PARTIAL_REFUND'",
      });
      return;
    }
    if (!notes || notes.trim().length < 10) {
      res.status(400).json({ success: false, error: 'Resolution notes required (min 10 chars)' });
      return;
    }

    const supabase = getServiceClient();
    const { settlement, reason } = await loadDisputedSettlement(supabase, settlementId);
    if (!settlement) {
      res.status(reason?.startsWith('Settlement is') ? 409 : 404).json({
        success: false,
        error: reason,
      });
      return;
    }

    if (action === 'PARTIAL_REFUND') {
      if (
        typeof partial_amount_cents !== 'number' ||
        !Number.isInteger(partial_amount_cents) ||
        partial_amount_cents <= 0
      ) {
        res.status(400).json({
          success: false,
          error: 'partial_amount_cents must be a positive integer when action = PARTIAL_REFUND',
        });
        return;
      }
      if (partial_amount_cents >= settlement.gross_amount_cents) {
        res.status(400).json({
          success: false,
          error:
            'partial_amount_cents must be less than the total — use FULL_REFUND for a complete refund',
        });
        return;
      }
    }

    const refundAmountCents =
      action === 'FULL_REFUND' ? settlement.gross_amount_cents : (partial_amount_cents as number);

    // Attempt the Stripe refund BEFORE mutating settlement state. If the
    // processor call fails, we leave the dispute open so admin can retry.
    const refundResult = await refundSettlement(supabase, {
      settlementId,
      amountCents: action === 'PARTIAL_REFUND' ? refundAmountCents : undefined,
      initiatedBy: adminId,
    });

    if (!refundResult.success) {
      console.error('approve_dispute_refund_failed', {
        settlementId,
        action,
        errorCode: refundResult.errorCode,
        errorMessage: refundResult.errorMessage,
      });
      res.status(502).json({
        success: false,
        error: `Refund failed: ${refundResult.errorMessage}`,
        code: refundResult.errorCode,
      });
      return;
    }

    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('settlements')
      .update({
        status: 'REFUNDED',
        resolution_action: action,
        partial_refund_amount_cents: action === 'PARTIAL_REFUND' ? refundAmountCents : null,
        dispute_resolution_notes: notes.trim(),
        processor_refund_id: refundResult.refundId,
        settled_at: now,
        updated_at: now,
      })
      .eq('id', settlementId);

    if (updateError) {
      // Refund already executed at Stripe but DB write failed. This is rare but
      // we surface it loudly so the admin knows the refund went out and a
      // manual reconciliation is needed.
      console.error('approve_dispute_update_failed_after_refund', {
        settlementId,
        refundId: refundResult.refundId,
        error: updateError,
      });
      res.status(500).json({
        success: false,
        error: 'Refund succeeded at processor but DB update failed — contact engineering',
        refundId: refundResult.refundId,
      });
      return;
    }

    // Notify both parties. Use the appropriate template per resolution.
    const settlementUrl = `${frontendBase()}/settlements/${settlementId}`;
    const notificationType =
      action === 'FULL_REFUND' ? 'DISPUTE_APPROVED_FULL' : 'DISPUTE_APPROVED_PARTIAL';
    const baseMeta = {
      settlementId,
      refundAmountCents,
      totalAmountCents: settlement.gross_amount_cents,
    };
    const payloads = [];
    if (settlement.buyer_id) {
      payloads.push({
        userId: settlement.buyer_id,
        type: notificationType,
        title: action === 'FULL_REFUND' ? 'Refund issued' : 'Partial refund issued',
        body: `A refund of $${(refundAmountCents / 100).toFixed(2)} has been issued to your original payment method.`,
        actionUrl: settlementUrl,
        metadata: { ...baseMeta, isSeller: false },
      });
    }
    if (settlement.seller_id) {
      payloads.push({
        userId: settlement.seller_id,
        type: notificationType,
        title:
          action === 'FULL_REFUND'
            ? 'Dispute resolved against you — full refund issued'
            : 'Partial refund issued from your sale',
        body:
          action === 'FULL_REFUND'
            ? 'The dispute on your sale was approved. The buyer received a full refund.'
            : `$${(refundAmountCents / 100).toFixed(2)} of the sale was refunded to the buyer.`,
        actionUrl: settlementUrl,
        metadata: { ...baseMeta, isSeller: true },
      });
    }
    await notificationService.sendBatch(supabase, payloads);

    res.json({
      success: true,
      settlementId,
      status: 'REFUNDED',
      resolutionAction: action,
      refundId: refundResult.refundId,
      refundAmountCents,
    });
  },
);

/**
 * POST /api/v1/admin/disputes/:settlementId/reject
 * Resolve a DISPUTED settlement in favor of the seller. No refund issued.
 * Body: { notes: string }  // admin resolution notes, min 10 chars
 *
 * On success: status → ESCROW_HOLD, appeal_deadline = now + 7d.
 * The buyer can POST /:id/dispute/appeal until appeal_deadline.
 */
const APPEAL_WINDOW_DAYS = 7;

router.post(
  '/:settlementId/reject',
  auditLog('reject_dispute', 'settlements'),
  async (req: Request, res: Response) => {
    const settlementId = req.params['settlementId'] as string;
    const { notes } = req.body as { notes?: string };
    const adminId = getAdminId(req);

    if (!adminId) {
      res.status(401).json({ success: false, error: 'Admin authentication required' });
      return;
    }
    if (!notes || notes.trim().length < 10) {
      res.status(400).json({ success: false, error: 'Resolution notes required (min 10 chars)' });
      return;
    }

    const supabase = getServiceClient();
    const { settlement, reason } = await loadDisputedSettlement(supabase, settlementId);
    if (!settlement) {
      res.status(reason?.startsWith('Settlement is') ? 409 : 404).json({
        success: false,
        error: reason,
      });
      return;
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const appealDeadline = new Date(
      now.getTime() + APPEAL_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    // If the original escrow window has already passed, push it to the appeal
    // deadline so release-escrow doesn't pick this up while the buyer is still
    // inside the appeal window.
    const restoredEscrowEnd =
      settlement.escrow_ends_at && settlement.escrow_ends_at > appealDeadline
        ? settlement.escrow_ends_at
        : appealDeadline;

    const { error: updateError } = await supabase
      .from('settlements')
      .update({
        status: 'ESCROW_HOLD',
        resolution_action: 'REJECTED',
        dispute_resolution_notes: notes.trim(),
        escrow_ends_at: restoredEscrowEnd,
        appeal_deadline: appealDeadline,
        updated_at: nowIso,
      })
      .eq('id', settlementId);

    if (updateError) {
      console.error('reject_dispute_update_failed', { settlementId, error: updateError });
      res.status(500).json({ success: false, error: 'Failed to reject dispute' });
      return;
    }

    const settlementUrl = `${frontendBase()}/settlements/${settlementId}`;
    const appealUrl = `${settlementUrl}?action=appeal`;
    const baseMeta = { settlementId };
    const payloads = [];
    if (settlement.buyer_id) {
      payloads.push({
        userId: settlement.buyer_id,
        type: 'DISPUTE_REJECTED',
        title: 'Dispute decision — payment will release to seller',
        body: `If you believe this was decided in error, you can appeal within ${APPEAL_WINDOW_DAYS} days.`,
        actionUrl: settlementUrl,
        metadata: {
          ...baseMeta,
          isSeller: false,
          appealUrl,
          appealDeadline: appealDeadline.slice(0, 10),
        },
      });
    }
    if (settlement.seller_id) {
      payloads.push({
        userId: settlement.seller_id,
        type: 'DISPUTE_REJECTED',
        title: 'Dispute decided in your favor',
        body: 'Escrow will continue to its normal release schedule.',
        actionUrl: settlementUrl,
        metadata: { ...baseMeta, isSeller: true },
      });
    }
    await notificationService.sendBatch(supabase, payloads);

    res.json({
      success: true,
      settlementId,
      status: 'ESCROW_HOLD',
      resolutionAction: 'REJECTED',
      appealDeadline,
    });
  },
);

export default router;
