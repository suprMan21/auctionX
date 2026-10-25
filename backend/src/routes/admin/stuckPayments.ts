import { Router } from 'express';
import { handle } from '../tagManagement';
import { requirePermission } from '../../middleware/adminAuth';
import { PERMISSIONS } from '../../lib/admin/permissions';
import {
  listStuckPayments,
  reapplyStuckPayment,
  refundStuckPayment,
  sweepStuckPayments,
} from '../../controllers/adminStuckPaymentsController';

/**
 * S-ADMIN1 Ph3a stuck-payment queue. The admin index has already run
 * verifyAdminAuth and adminRateLimit. Support may view, Re-apply and run the
 * sweep (reapply_payments); a refund needs refund_token_fees (admin,
 * super_admin; Locked 2026-10-03).
 */
const router = Router();

router.use(requirePermission(PERMISSIONS.reapplyPayments));

router.get('/', handle(listStuckPayments));
router.post('/sweep', handle(sweepStuckPayments));
router.post('/:id/reapply', handle(reapplyStuckPayment));
router.post('/:id/refund', requirePermission(PERMISSIONS.refundTokenFees), handle(refundStuckPayment));

export default router;
