import { Router } from 'express';
import { handle } from '../tagManagement';
import { requirePermission } from '../../middleware/adminAuth';
import { PERMISSIONS } from '../../lib/admin/permissions';
import { cancelPrice, listPrices, setPrice } from '../../controllers/adminPricingController';

/**
 * S-ADMIN1 Ph3b token prices. The admin index has already run verifyAdminAuth
 * and adminRateLimit. Needs manage_pricing (admin, super_admin; Locked 2026-10-03).
 */
const router = Router();

router.use(requirePermission(PERMISSIONS.managePricing));

router.get('/', handle(listPrices));
router.post('/', handle(setPrice));
router.post('/:id/cancel', handle(cancelPrice));

export default router;
