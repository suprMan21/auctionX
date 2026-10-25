import { Router } from 'express';
import { handle } from '../tagManagement';
import { requireAdminRole } from '../../lib/admin/paymentAdmin';
import { PRICING_ROLES } from '../../lib/admin/pricingAdmin';
import { grantVouchers, listVouchers, revokeVoucher } from '../../controllers/adminPricingController';

/**
 * S-ADMIN1 Ph3b free-transfer vouchers, granted to an account (Locked
 * 2026-10-11). Admin and super_admin only.
 */
const router = Router();

router.use(requireAdminRole(PRICING_ROLES));

router.get('/', handle(listVouchers));
router.post('/', handle(grantVouchers));
router.post('/:id/revoke', handle(revokeVoucher));

export default router;
