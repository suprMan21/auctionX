import { Router, RequestHandler } from 'express';
import { getSettlement } from '../controllers/settlementController';
import { openDispute } from '../controllers/payoutController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/:id', requireAuth, getSettlement as unknown as RequestHandler);
router.post('/:id/dispute', requireAuth, openDispute as unknown as RequestHandler);

export default router;
