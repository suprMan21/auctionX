import { Router } from 'express';
import { handle } from '../tagManagement';
import { getGrowth } from '../../controllers/adminStatsController';

/**
 * Admin console UX-3, AC 6 — dashboard numbers. The admin index has already
 * run verifyAdminAuth and adminRateLimit. The permission depends on the
 * `series` query parameter (tokens: manage_nfc, accounts: view_users), so the
 * controller checks it after parsing; the database function re-checks it.
 */
const router = Router();

router.get('/growth', handle(getGrowth));

export default router;
