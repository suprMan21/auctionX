import { Router } from 'express';
import { handle } from '../tagManagement';
import { requirePermission } from '../../middleware/adminAuth';
import { PERMISSIONS } from '../../lib/admin/permissions';
import { grantVouchers, listVouchers, revokeVoucher } from '../../controllers/adminPricingController';

/**
 * S-ADMIN1 Ph3b free-transfer vouchers, granted to an account (Locked
 * 2026-10-11). Needs manage_pricing (admin, super_admin).
 */
const router = Router();

router.use(requirePermission(PERMISSIONS.managePricing));

router.get('/', handle(listVouchers));
router.post('/', handle(grantVouchers));
router.post('/:id/revoke', handle(revokeVoucher));

export default router;
