import { Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { RequestWithId } from '../middleware/requestId';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../lib/errors';
import { withLogContext } from '../lib/logger';

interface DeliveryRequest extends RequestWithId, AuthRequest {}

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getServiceClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

/**
 * POST /api/v1/delivery/:settlementId/confirm-delivery
 *
 * Buyer confirms physical receipt of the item. Marks the settlement so the
 * release-escrow scheduled job releases funds immediately on its next tick,
 * skipping the 72h escrow hold. Idempotent — re-confirming is a no-op.
 */
export const confirmDelivery = async (req: DeliveryRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const settlementId = req.params.settlementId;
    if (!settlementId) {
      throw new AppError('invalid_argument', 'settlementId is required');
    }

    const supabase = getServiceClient();

    const { data: settlement, error: fetchError } = await supabase
      .from('settlements')
      .select('id, buyer_id, status, delivery_confirmed_at, delivery_confirmed_by')
      .eq('id', settlementId)
      .maybeSingle();

    if (fetchError) {
      logger.error('confirm_delivery_fetch_failed', { settlementId, error: fetchError });
      throw new AppError('internal', 'Failed to load settlement');
    }
    if (!settlement) {
      throw new AppError('not_found', 'Settlement not found');
    }

    if (settlement.buyer_id !== userId) {
      throw new AppError('permission_denied', 'Only the buyer may confirm delivery');
    }

    if (settlement.delivery_confirmed_at) {
      // Idempotent: already confirmed → return current state without rewriting.
      return res.json({
        success: true,
        data: {
          settlementId: settlement.id,
          deliveryConfirmedAt: settlement.delivery_confirmed_at,
          deliveryConfirmedBy: settlement.delivery_confirmed_by,
          status: settlement.status,
        },
      });
    }

    if (settlement.status !== 'ESCROW_HOLD') {
      throw new AppError(
        'failed_precondition',
        `Cannot confirm delivery on settlement in status ${settlement.status}`,
      );
    }

    const nowIso = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('settlements')
      .update({
        delivery_confirmed_at: nowIso,
        delivery_confirmed_by: userId,
        updated_at: nowIso,
      })
      .eq('id', settlementId);

    if (updateError) {
      logger.error('confirm_delivery_update_failed', { settlementId, error: updateError });
      throw new AppError('internal', 'Failed to record delivery confirmation');
    }

    logger.info('delivery_confirmed', { settlementId, userId });

    return res.json({
      success: true,
      data: {
        settlementId,
        deliveryConfirmedAt: nowIso,
        deliveryConfirmedBy: userId,
        status: settlement.status,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
