import { Router } from 'express';
import { verifyAdminAuth } from '../../middleware/adminAuth';
import { adminRateLimit } from '../../middleware/adminRateLimit';
import { isMarketplaceEnabled } from '../../lib/featureFlags';
import usersRouter from './users';
import moderationRouter from './moderation';
import auditLogsRouter from './auditLogs';
import adminAuctionsRouter from './auctions';
import disputesRouter from './disputes';
import escrowRouter from './escrow';
import sellerVerificationRouter from './sellerVerification';
import yotiVerificationsRouter from './verifications';
import healthRouter from './health';

const router = Router();

// Zero trust middleware stack — runs on EVERY admin request in order:
// 1. verifyAdminAuth  — JWT valid? In admin_users? is_active? session_version check?
// 2. adminRateLimit   — Not hammering destructive actions?
// Individual routes can still add requirePermission() and requireBrandAccess() on top.
//
// The stack runs BEFORE the allowlist below, so a parked admin path still
// 401s for an unauthenticated caller rather than revealing that it is parked.
router.use(verifyAdminAuth);
router.use(adminRateLimit);

// ── Allowlist: admin surfaces the token platform needs (S-ISO1) ─────────────
// Admin is a MIXED router — account administration and the Yoti review queue
// are token-platform concerns, while auctions/escrow/disputes/moderation serve
// the parked marketplace. So it gets a sub-allowlist rather than being parked
// wholesale.
router.use('/health', healthRouter);
router.use('/users', usersRouter);            // account admin — anonymous ownership still needs suspend/ban
router.use('/audit-logs', auditLogsRouter);   // compliance / chain-of-custody evidence trail
router.use('/verifications', yotiVerificationsRouter); // Yoti ID review (Premier, S-TIER1)

// ── Parked: marketplace admin. Nothing deleted; see docs/PARKED_MARKETPLACE.md
if (isMarketplaceEnabled()) {
  router.use('/moderation', moderationRouter);           // moderation_queue over listings
  router.use('/auctions', adminAuctionsRouter);          // also imports triggerSettlement
  router.use('/disputes', disputesRouter);               // imports refundSettlement
  router.use('/escrow', escrowRouter);
  router.use('/seller-verification', sellerVerificationRouter); // legacy S3 KYC, superseded by Yoti
}

export default router;
