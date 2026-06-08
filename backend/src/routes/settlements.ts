import { Router, RequestHandler } from 'express';
import { getSettlement } from '../controllers/settlementController';
import {
  openDispute,
  openDisputeAppeal,
  getDisputeEvidenceUploadUrl,
} from '../controllers/payoutController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/:id', requireAuth, getSettlement as unknown as RequestHandler);
router.post('/:id/dispute', requireAuth, openDispute as unknown as RequestHandler);
router.post(
  '/:id/dispute/evidence',
  requireAuth,
  getDisputeEvidenceUploadUrl as unknown as RequestHandler,
);
router.post(
  '/:id/dispute/appeal',
  requireAuth,
  openDisputeAppeal as unknown as RequestHandler,
);

export default router;
