import { Router, RequestHandler } from 'express';
import { confirmDelivery } from '../controllers/deliveryController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.post('/:settlementId/confirm-delivery', requireAuth, confirmDelivery as unknown as RequestHandler);

export default router;
