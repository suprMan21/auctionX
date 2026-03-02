import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { RequestWithId } from '../middleware/requestId';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../lib/errors';
import { withLogContext } from '../lib/logger';

interface SettlementRequest extends Request, RequestWithId, AuthRequest {}

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getServiceClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

/**
 * GET /api/v1/settlements/:id
 * Returns settlement detail for buyer or seller. Auth required.
 */
export const getSettlement = async (req: SettlementRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      throw new AppError('unauthenticated', 'Authentication required');
    }

    const supabase = getServiceClient();

    const { data: settlement, error } = await supabase
      .from('settlements')
      .select(`
        *,
        auction:auctions(
          id,
          listing_id,
          current_price_cents,
          currency,
          status
        ),
        offers:settlement_offers(*)
      `)
      .eq('id', id)
      .single();

    if (error || !settlement) {
      logger.warn('settlement_not_found', { settlementId: id, error });
      throw new AppError('not_found', 'Settlement not found');
    }

    // Restrict to buyer or seller only
    if (settlement.buyer_id !== userId && settlement.seller_id !== userId) {
      throw new AppError('permission_denied', 'Access denied');
    }

    const role = settlement.buyer_id === userId ? 'buyer' : 'seller';

    logger.info('settlement_fetched', { settlementId: id, role });

    return res.json({
      success: true,
      data: { ...settlement, role },
    });
  } catch (error) {
    if (error instanceof AppError) {
      logger.warn('get_settlement_failed', { code: error.code, message: error.message });
      return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    }
    logger.error('get_settlement_error', { error });
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * GET /api/v1/auctions/:id/settlement
 * Lightweight public endpoint — returns {settlementId, status} or 404.
 * No auth required (status info only, no amounts).
 */
export const getAuctionSettlement = async (req: SettlementRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const { id: auctionId } = req.params;
    const supabase = getServiceClient();

    const { data: settlement, error } = await supabase
      .from('settlements')
      .select('id, status, buyer_id, payment_window_expires_at')
      .eq('auction_id', auctionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !settlement) {
      return res.status(404).json({ success: false, error: 'No settlement found' });
    }

    // Find active offer
    const { data: activeOffer } = await supabase
      .from('settlement_offers')
      .select('id, payment_window_expires_at')
      .eq('settlement_id', settlement.id)
      .eq('status', 'PENDING_PAYMENT')
      .order('offer_rank', { ascending: false })
      .limit(1)
      .single();

    logger.info('auction_settlement_fetched', { auctionId, settlementId: settlement.id });

    return res.json({
      success: true,
      data: {
        settlementId: settlement.id,
        status: settlement.status,
        buyerId: settlement.buyer_id,
        activeOfferId: activeOffer?.id ?? null,
        paymentWindowExpiresAt: activeOffer?.payment_window_expires_at ?? null,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.status).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * POST /api/v1/admin/auctions/:id/settle
 * Admin endpoint that triggers the settle-auction Edge Function.
 * Requires admin auth (enforced by admin router middleware).
 */
export const triggerSettlement = async (req: SettlementRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const { id: auctionId } = req.params;

    const settleSecret = process.env.SETTLE_SECRET;
    if (!settleSecret) {
      logger.error('trigger_settlement_no_secret', { auctionId });
      throw new AppError('internal', 'SETTLE_SECRET not configured');
    }

    const edgeFnUrl = `${process.env.SUPABASE_URL}/functions/v1/settle-auction`;

    logger.info('trigger_settlement_attempt', { auctionId, edgeFnUrl });

    const response = await fetch(edgeFnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-settle-secret': settleSecret,
      },
      body: JSON.stringify({ auctionId }),
    });

    const body = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      logger.warn('trigger_settlement_edge_fn_error', { auctionId, status: response.status });
      return res.status(response.status).json({ success: false, error: (body['error'] as string) ?? 'Settlement failed' });
    }

    logger.info('trigger_settlement_success', { auctionId });

    return res.json({ success: true, data: body });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.status).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
