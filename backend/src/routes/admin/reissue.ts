import { Router } from 'express';
import { requirePermission } from '../../middleware/adminAuth';
import { MANAGE_NFC } from '../../lib/admin/tokenAdmin';
import { handle } from '../tagManagement';
import { approvalGated } from '../../controllers/adminApprovalsController';
import {
  listReissueRequests,
  approveReissue,
  rejectReissue,
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
// S-2FA Ph3a: every chip swap from a re-issue waits for a second admin (super_admin acts alone).
router.post('/:id/fulfil', handle(approvalGated('reissue_fulfil')));

export default router;
