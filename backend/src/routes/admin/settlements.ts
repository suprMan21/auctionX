import { Router, RequestHandler } from 'express';
import { triggerSettlement } from '../../controllers/settlementController';

const router = Router();

// POST /api/v1/admin/auctions/:id/settle
// Admin auth is enforced by the parent admin router middleware.
router.post('/:id/settle', triggerSettlement as unknown as RequestHandler);

export default router;
