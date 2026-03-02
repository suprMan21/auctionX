import { Router } from 'express';
import { verifyAdminAuth } from '../../middleware/adminAuth';
import { adminRateLimit } from '../../middleware/adminRateLimit';
import usersRouter from './users';
import moderationRouter from './moderation';
import auditLogsRouter from './auditLogs';
import adminSettlementsRouter from './settlements';
import disputesRouter from './disputes';

const router = Router();

// Zero trust middleware stack — runs on EVERY admin request in order:
// 1. verifyAdminAuth  — JWT valid? In admin_users? is_active? session_version check?
// 2. adminRateLimit   — Not hammering destructive actions?
// Individual routes can still add requirePermission() and requireBrandAccess() on top.
router.use(verifyAdminAuth);
router.use(adminRateLimit);

router.use('/users', usersRouter);
router.use('/moderation', moderationRouter);
router.use('/audit-logs', auditLogsRouter);
router.use('/auctions', adminSettlementsRouter);
router.use('/disputes', disputesRouter);

export default router;
