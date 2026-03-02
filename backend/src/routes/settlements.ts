import { Router, RequestHandler } from 'express';
import { getSettlement } from '../controllers/settlementController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/:id', requireAuth, getSettlement as unknown as RequestHandler);

export default router;
