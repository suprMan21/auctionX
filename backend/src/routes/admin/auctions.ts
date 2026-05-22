import { Router, type RequestHandler } from 'express';
import {
  listAuctions,
  getAuctionDetail,
  endAuction,
  cancelAuction,
  restartAuction,
} from '../../controllers/adminAuctionsController';
import { triggerSettlement } from '../../controllers/settlementController';
import { auditLog } from '../../middleware/auditLog';

const router = Router();

// Admin auth + rate limiting are enforced by the parent admin router.
// auditLog() chains after the handler — it intercepts res.send to write an audit_logs row on 2xx.

router.get('/', listAuctions as unknown as RequestHandler);
router.get('/:id', getAuctionDetail as unknown as RequestHandler);
router.post('/:id/end', auditLog('end_auction', 'auction'), endAuction as unknown as RequestHandler);
router.post('/:id/cancel', auditLog('cancel_auction', 'auction'), cancelAuction as unknown as RequestHandler);
router.post('/:id/restart', auditLog('restart_auction', 'auction'), restartAuction as unknown as RequestHandler);
router.post('/:id/settle', auditLog('settle_auction', 'auction'), triggerSettlement as unknown as RequestHandler);

export default router;
