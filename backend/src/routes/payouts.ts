import { Router, RequestHandler } from 'express';
import { listPayouts } from '../controllers/payoutController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, listPayouts as unknown as RequestHandler);

export default router;
