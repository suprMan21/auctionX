import { Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { RequestWithId } from '../middleware/requestId';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../lib/errors';
import { withLogContext } from '../lib/logger';
import { notificationService } from '../lib/notifications/notificationService';

interface PayoutRequest extends RequestWithId, AuthRequest {}

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getServiceClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

/**
 * GET /api/v1/payouts
 * Returns all payouts for the authenticated seller.
 * Uses service client with explicit seller_id filter (RLS as defence-in-depth).
 */
export const listPayouts = async (req: PayoutRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const supabase = getServiceClient();

    const { data: payouts, error } = await supabase
      .from('payouts')
      .select('*')
      .eq('seller_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('list_payouts_db_error', { userId, error });
      throw new AppError('internal', 'Failed to fetch payouts');
    }

    logger.info('payouts_listed', { userId, count: payouts?.length ?? 0 });

    return res.json({ success: true, data: payouts ?? [] });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * POST /api/v1/settlements/:id/dispute
 * Opens a dispute on an ESCROW_HOLD settlement.
 * Buyer only. Requires `reason` body field (min 20 chars).
 * Adds settlement to moderation_queue for admin review.
 */
export const openDispute = async (req: PayoutRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const settlementId = req.params['id'] as string;
    const { reason } = req.body as { reason?: string };

    if (!reason || reason.trim().length < 20) {
      throw new AppError('invalid_argument', 'Dispute reason must be at least 20 characters');
    }

    const supabase = getServiceClient();

    // Fetch settlement to verify buyer and status
    const { data: settlement, error: fetchError } = await supabase
      .from('settlements')
      .select('id, buyer_id, seller_id, status, auction_id')
      .eq('id', settlementId)
      .single();

    if (fetchError || !settlement) {
      throw new AppError('not_found', 'Settlement not found');
    }

    if (settlement.buyer_id !== userId) {
      throw new AppError('permission_denied', 'Only the buyer can open a dispute');
    }

    if (settlement.status !== 'ESCROW_HOLD') {
      throw new AppError(
        'conflict',
        `Cannot open dispute — settlement status is '${settlement.status}' (must be 'ESCROW_HOLD')`,
      );
    }

    const now = new Date().toISOString();

    // Update settlement → DISPUTED
    const { error: updateError } = await supabase
      .from('settlements')
      .update({
        status: 'DISPUTED',
        dispute_reason: reason.trim(),
        dispute_opened_at: now,
        updated_at: now,
      })
      .eq('id', settlementId);

    if (updateError) {
      logger.error('open_dispute_update_failed', { settlementId, error: updateError });
      throw new AppError('internal', 'Failed to open dispute');
    }

    // Add to moderation_queue for admin review
    const { error: mqError } = await supabase
      .from('moderation_queue')
      .insert({
        listing_id: null,
        reported_by: userId,
        reason: `Dispute: ${reason.trim().slice(0, 500)}`,
        status: 'PENDING',
      });

    if (mqError) {
      // Non-fatal — dispute status is already set; admin can find via settlements table
      logger.warn('open_dispute_moderation_queue_failed', { settlementId, error: mqError });
    }

    // Notify both seller and buyer about the dispute
    const sellerId = Array.isArray(settlement.seller_id) ? settlement.seller_id[0] : settlement.seller_id;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const settlementUrl = `${frontendUrl}/settlements/${settlementId}`;
    await notificationService.sendBatch(supabase, [
      {
        userId: sellerId,
        type: 'DISPUTE_OPENED',
        title: 'A dispute has been opened',
        body: 'The buyer has opened a dispute on your settlement. Our team will review it.',
        actionUrl: settlementUrl,
        metadata: { settlementId, buyerId: userId },
      },
      {
        userId,
        type: 'DISPUTE_OPENED',
        title: 'Your dispute has been received',
        body: 'Your dispute is under review. Our moderation team will follow up.',
        actionUrl: settlementUrl,
        metadata: { settlementId },
      },
    ]);

    logger.info('dispute_opened', { settlementId, buyerId: userId });

    return res.json({ success: true });
  } catch (error) {
    if (error instanceof AppError) {
      logger.warn('open_dispute_failed', { code: error.code, message: error.message });
      return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
