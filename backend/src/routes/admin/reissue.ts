import { Router } from 'express';
import { requirePermission } from '../../middleware/adminAuth';
import { MANAGE_NFC } from '../../lib/admin/tokenAdmin';
import { handle } from '../tagManagement';
import {
  listReissueRequests,
  approveReissue,
  rejectReissue,
  fulfilReissue,
} from '../../controllers/adminReissueController';

/**
 * S-ADMIN1 Ph2 re-issue queue. The admin index has already run verifyAdminAuth
 * and adminRateLimit; every route here additionally needs manage_nfc.
 */
const router = Router();

router.use(requirePermission(MANAGE_NFC));

router.get('/', handle(listReissueRequests));
router.post('/:id/approve', handle(approveReissue));
router.post('/:id/reject', handle(rejectReissue));
router.post('/:id/fulfil', handle(fulfilReissue));

export default router;
