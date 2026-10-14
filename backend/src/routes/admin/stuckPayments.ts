import { Router } from 'express';
import { handle } from '../tagManagement';
import {
  PAYMENT_QUEUE_ROLES,
  PAYMENT_REFUND_ROLES,
  requireAdminRole,
} from '../../lib/admin/paymentAdmin';
import {
  listStuckPayments,
  reapplyStuckPayment,
  refundStuckPayment,
  sweepStuckPayments,
} from '../../controllers/adminStuckPaymentsController';

/**
 * S-ADMIN1 Ph3a stuck-payment queue. The admin index has already run
 * verifyAdminAuth and adminRateLimit. Support may view, Re-apply and run the
 * sweep; a refund needs admin or super_admin (Locked 2026-10-03).
 */
const router = Router();

router.use(requireAdminRole(PAYMENT_QUEUE_ROLES));

router.get('/', handle(listStuckPayments));
router.post('/sweep', handle(sweepStuckPayments));
router.post('/:id/reapply', handle(reapplyStuckPayment));
router.post('/:id/refund', requireAdminRole(PAYMENT_REFUND_ROLES), handle(refundStuckPayment));

export default router;
