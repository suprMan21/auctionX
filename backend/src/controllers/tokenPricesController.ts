/**
 * S-ADMIN1 Ph3b — what a signed-in user sees of prices and vouchers.
 *
 *   GET /api/v1/nfc/prices         prices in effect now (USD cents)
 *   GET /api/v1/nfc/vouchers/mine  free transfers the caller can use now
 *
 * The frontend shows these instead of hard-coded amounts. What a transfer
 * actually costs is still decided server-side when it is started.
 */

import type { Response } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RequestWithId } from '../middleware/requestId';
import type { AuthRequest } from '../middleware/auth';
import { AppError } from '../lib/errors';
import { availableVoucherCount, currentPrices } from '../lib/tokenPrices';

interface PricesRequest extends RequestWithId, AuthRequest {}

const getServiceClient = (): SupabaseClient =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const ok = <T>(res: Response, data: T) => res.status(200).json({ success: true, data, error: null });

export const getPrices = async (req: PricesRequest, res: Response) => {
  if (!req.user?.id) throw new AppError('unauthenticated', 'Authentication required');
  const prices = await currentPrices(getServiceClient());
  return ok(res, {
    currency: 'usd',
    transferUsdCents: prices.transfer,
    reissueUsdCents: prices.reissue,
    tokenUsdCents: prices.token,
  });
};

export const getMyVouchers = async (req: PricesRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) throw new AppError('unauthenticated', 'Authentication required');
  const available = await availableVoucherCount(getServiceClient(), userId);
  return ok(res, { freeTransfers: available });
};
