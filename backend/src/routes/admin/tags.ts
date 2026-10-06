import { Router } from 'express';
import { requirePermission } from '../../middleware/adminAuth';
import { MANAGE_NFC } from '../../lib/admin/tokenAdmin';
import { handle } from '../tagManagement';
import {
  listTags,
  getTag,
  suspendTag,
  unsuspendTag,
  resetTag,
} from '../../controllers/adminTagController';

/**
 * S-ADMIN1 token admin console. The admin index has already run verifyAdminAuth
 * and adminRateLimit; every route here additionally needs manage_nfc.
 * Responses use the standard `{ success, data, error }` envelope via `handle`.
 */
const router = Router();

router.use(requirePermission(MANAGE_NFC));

router.get('/', handle(listTags));
router.get('/:tagId', handle(getTag));
router.post('/:tagId/suspend', handle(suspendTag));
router.post('/:tagId/unsuspend', handle(unsuspendTag));
router.post('/:tagId/reset', handle(resetTag));

export default router;
