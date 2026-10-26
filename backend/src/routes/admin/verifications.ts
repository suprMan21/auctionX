/**
 * Admin Yoti verifications routes — mounted at /api/v1/admin/verifications.
 *
 * Sits behind the parent admin router's verifyAdminAuth + adminRateLimit
 * stack (see routes/admin/index.ts). Permission gates: `view_creator_ids` to
 * open (super_admin, admin, support), `manage_creator_ids` to change a status
 * (super_admin, admin). Migrations 20261026000002/3; was `review_sellers`.
 *
 * Static routes registered before parameterized per Lesson #5.
 */

import { Router, type RequestHandler } from 'express';
import { requirePermission } from '../../middleware/adminAuth';
import { auditLog } from '../../middleware/auditLog';
import {
  listVerifications,
  getVerificationDetail,
  overrideVerification,
} from '../../controllers/adminYotiVerificationController';

const router = Router();

router.get(
  '/',
  requirePermission('view_creator_ids') as unknown as RequestHandler,
  listVerifications as unknown as RequestHandler,
);

router.get(
  '/:userId',
  requirePermission('view_creator_ids') as unknown as RequestHandler,
  getVerificationDetail as unknown as RequestHandler,
);

router.post(
  '/:userId/override',
  requirePermission('manage_creator_ids') as unknown as RequestHandler,
  auditLog('override_verification', 'users') as unknown as RequestHandler,
  overrideVerification as unknown as RequestHandler,
);

export default router;
