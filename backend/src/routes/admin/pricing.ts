import { Router } from 'express';
import { handle } from '../tagManagement';
import { requirePermission } from '../../middleware/adminAuth';
import { PERMISSIONS } from '../../lib/admin/permissions';
import { requireStepUp } from '../../middleware/mfaGates';
import { cancelPrice, listPrices, setPrice } from '../../controllers/adminPricingController';

/**
 * S-ADMIN1 Ph3b token prices. The admin index has already run verifyAdminAuth
 * and adminRateLimit. Needs manage_pricing (admin, super_admin; Locked 2026-10-03).
 */
const router = Router();

router.use(requirePermission(PERMISSIONS.managePricing));

router.get('/', handle(listPrices));
// S-2FA: a price change needs a fresh passkey check (FEATURE_REQUIRE_STEP_UP).
router.post('/', requireStepUp('price_change', () => 'token_prices'), handle(setPrice));
router.post('/:id/cancel', requireStepUp('price_change', (req) => `price:${req.params.id}`), handle(cancelPrice));

export default router;
