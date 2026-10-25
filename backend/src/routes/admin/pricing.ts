import { Router } from 'express';
import { handle } from '../tagManagement';
import { requireAdminRole } from '../../lib/admin/paymentAdmin';
import { PRICING_ROLES } from '../../lib/admin/pricingAdmin';
import { cancelPrice, listPrices, setPrice } from '../../controllers/adminPricingController';

/**
 * S-ADMIN1 Ph3b token prices. The admin index has already run verifyAdminAuth
 * and adminRateLimit. Admin and super_admin only (Locked 2026-10-03).
 */
const router = Router();

router.use(requireAdminRole(PRICING_ROLES));

router.get('/', handle(listPrices));
router.post('/', handle(setPrice));
router.post('/:id/cancel', handle(cancelPrice));

export default router;
