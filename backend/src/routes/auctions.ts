import { Router, RequestHandler } from 'express';
import { getAuction, getBidHistory } from '../controllers/auctionController';
import { placeBid } from '../controllers/bidController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/:id', getAuction as unknown as RequestHandler);
router.get('/:id/bids', getBidHistory as unknown as RequestHandler);
router.post('/:id/bids', requireAuth, placeBid as unknown as RequestHandler);

export default router;
