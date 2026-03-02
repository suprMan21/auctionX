import { Router, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { getAuction, getBidHistory } from '../controllers/auctionController';
import { placeBid } from '../controllers/bidController';
import { getAuctionSettlement } from '../controllers/settlementController';
import { requireAuth } from '../middleware/auth';

const router = Router();

const bidLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many bid attempts. Try again shortly.' },
});

router.get('/:id', getAuction as unknown as RequestHandler);
router.get('/:id/bids', getBidHistory as unknown as RequestHandler);
router.get('/:id/settlement', getAuctionSettlement as unknown as RequestHandler);
router.post('/:id/bids', requireAuth, bidLimiter, placeBid as unknown as RequestHandler);

export default router;
