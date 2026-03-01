import { Request, Response } from 'express';
import { RequestWithId } from '../middleware/requestId';
import { supabase } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { withLogContext } from '../lib/logger';

interface AuctionRequest extends Request, RequestWithId {}

export const getAuction = async (req: AuctionRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });
  
  try {
    const id = req.params.id as string;
    
    logger.debug('fetch_auction_attempt', { auctionId: id });

    const { data: auction, error } = await supabase
      .from('auctions')
      .select(`
        *,
        listing:listings(*)
      `)
      .eq('id', id)
      .single();

    if (error || !auction) {
      logger.warn('auction_not_found', { auctionId: id, error });
      throw new AppError('not_found', 'Auction not found');
    }

    logger.info('auction_fetched', { auctionId: id, status: auction.status });
    res.json(auction);
    
  } catch (error) {
    if (error instanceof AppError) {
      logger.warn('fetch_auction_failed', { 
        code: error.code,
        message: error.message 
      });
      return res.status(error.status).json({
        error: error.message,
        code: error.code
      });
    }
    
    logger.error('fetch_auction_error', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getBidHistory = async (req: AuctionRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });
  
  try {
    const id = req.params.id as string;
    
    logger.debug('fetch_bid_history_attempt', { auctionId: id });

    const { data: bids, error } = await supabase
      .from('bids')
      .select('*')
      .eq('auction_id', id)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('fetch_bids_failed', { auctionId: id, error });
      throw new AppError('internal', error.message);
    }

    logger.info('bid_history_fetched', { auctionId: id, count: bids?.length || 0 });
    res.json(bids || []);
    
  } catch (error) {
    if (error instanceof AppError) {
      logger.warn('fetch_bid_history_failed', { 
        code: error.code,
        message: error.message 
      });
      return res.status(error.status).json({
        error: error.message,
        code: error.code
      });
    }
    
    logger.error('fetch_bid_history_error', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
};
