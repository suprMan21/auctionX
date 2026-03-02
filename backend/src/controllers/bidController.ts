import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { withLogContext } from '../lib/logger';
import { AppError } from '../lib/errors';
import type { Database } from '../types/database';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;

export async function placeBid(req: Request, res: Response, next: NextFunction) {
  const log = withLogContext(req);
  const auctionId = req.params.id as string;
  const { amountCents, maxBidCents } = req.body;
  const userId = req.user!.id;

  try {
    log.info('place_bid_attempt', { userId });
    log.debug('fetching_auction', { auctionId });

    const authToken = req.headers.authorization?.replace('Bearer ', '');
    if (!authToken) {
      throw new AppError('unauthenticated', 'No auth token provided');
    }

    const userSupabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      },
    });

    const { data: auction, error: auctionError } = await userSupabase
      .from('auctions')
      .select('*')
      .eq('id', auctionId)
      .single();

    if (auctionError || !auction) {
      log.debug('auction_not_found', { auctionId });
      throw new AppError('not_found', 'Auction not found');
    }

    if (auction.status !== 'ACTIVE') {
      log.debug('auction_not_active', { auctionId, status: auction.status });
      throw new AppError('failed_precondition', 'Auction is not active');
    }

    if (new Date(auction.end_time) < new Date()) {
      log.debug('auction_ended', { auctionId, endTime: auction.end_time });
      throw new AppError('failed_precondition', 'Auction has ended');
    }

    if (auction.seller_id === userId) {
      log.debug('self_bidding_attempt', { auctionId, userId });
      throw new AppError('failed_precondition', 'Cannot bid on your own auction');
    }

    const minimumBid = auction.current_price_cents + auction.minimum_increment_cents;
    if (amountCents < minimumBid) {
      log.debug('bid_too_low', { auctionId, amountCents, minimumBid });
      throw new AppError(
        'invalid_argument',
        `Bid must be at least ${minimumBid} cents`
      );
    }

    log.debug('inserting_bid', { auctionId, amountCents, hasMaxBid: !!maxBidCents });

    const { data: bid, error: bidError } = await userSupabase
      .from('bids')
      .insert({
        auction_id: auctionId,
        bidder_id: userId,
        amount_cents: amountCents,
        max_bid_cents: maxBidCents || null,
      })
      .select()
      .single();

    if (bidError) {
      log.error('bid_insert_failed', { auctionId, error: bidError });
      throw new AppError('internal', bidError.message);
    }

    const { data: updatedAuction } = await userSupabase
      .from('auctions')
      .select('current_price_cents, high_bidder_id')
      .eq('id', auctionId)
      .single();

    const isHighBidder = updatedAuction?.high_bidder_id === userId;

    log.info('bid_placed_success', {
      auctionId,
      bidId: bid.id,
      amountCents,
      isHighBidder,
      currentPrice: updatedAuction?.current_price_cents,
    });

    res.json({
      success: true,
      bid,
      isHighBidder,
      currentPrice: updatedAuction?.current_price_cents,
    });
  } catch (error) {
    log.warn((error as Error).message, { code: 'internal' });
    next(error);
  }
}
