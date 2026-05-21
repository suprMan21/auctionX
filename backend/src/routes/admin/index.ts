import { Router } from 'express';
import { verifyAdminAuth } from '../../middleware/adminAuth';
import { adminRateLimit } from '../../middleware/adminRateLimit';
import usersRouter from './users';
import moderationRouter from './moderation';
import auditLogsRouter from './auditLogs';
import adminAuctionsRouter from './auctions';
import disputesRouter from './disputes';
import escrowRouter from './escrow';
import sellerVerificationRouter from './sellerVerification';
import healthRouter from './health';

const router = Router();

// Zero trust middleware stack — runs on EVERY admin request in order:
// 1. verifyAdminAuth  — JWT valid? In admin_users? is_active? session_version check?
// 2. adminRateLimit   — Not hammering destructive actions?
// Individual routes can still add requirePermission() and requireBrandAccess() on top.
router.use(verifyAdminAuth);
router.use(adminRateLimit);

router.use('/health', healthRouter);
router.use('/users', usersRouter);
router.use('/moderation', moderationRouter);
router.use('/audit-logs', auditLogsRouter);
router.use('/auctions', adminAuctionsRouter);
router.use('/disputes', disputesRouter);
router.use('/escrow', escrowRouter);
router.use('/seller-verification', sellerVerificationRouter);

export default router;
