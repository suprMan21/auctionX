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
import tagsRouter from './tags';
import reissueRouter from './reissue';
import stuckPaymentsRouter from './stuckPayments';
import pricingRouter from './pricing';
import vouchersRouter from './vouchers';
import accountSettingsRouter from './accountSettings';
import statsRouter from './stats';
import approvalsRouter from './approvals';
import { handle } from '../tagManagement';
import { getMe } from '../../controllers/adminAccountsController';

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
router.get('/me', handle(getMe));             // S-ADMIN2: role + permissions for the console
router.use('/health', healthRouter);
router.use('/users', usersRouter);            // S-ADMIN2 accounts: search, suspend/retire/delete, roles
router.use('/account-settings', accountSettingsRouter); // S-ADMIN2: Retire -> Delete waiting window
router.use('/audit-logs', auditLogsRouter);   // compliance / chain-of-custody evidence trail
router.use('/verifications', yotiVerificationsRouter); // Yoti ID review (Premier, S-TIER1)
router.use('/tags', tagsRouter);              // S-ADMIN1 token admin: inventory, suspend, atomic reset
router.use('/reissue-requests', reissueRouter); // S-ADMIN1 Ph2 re-issue queue: approve/waive/reject, fulfil
router.use('/stuck-payments', stuckPaymentsRouter); // S-ADMIN1 Ph3a: paid-but-unapplied token fees: Re-apply, refund, sweep
router.use('/pricing', pricingRouter);        // S-ADMIN1 Ph3b: admin-set token prices (effective-dated)
router.use('/vouchers', vouchersRouter);      // S-ADMIN1 Ph3b: free-transfer vouchers granted to accounts
router.use('/approvals', approvalsRouter);    // S-2FA Ph3a: two-admin approval queue
router.use('/stats', statsRouter);            // UX-3 AC 6: dashboard growth counts (tokens: manage_nfc, accounts: view_users)

// ── Parked: marketplace admin. Nothing deleted; see docs/PARKED_MARKETPLACE.md
if (isMarketplaceEnabled()) {
  router.use('/moderation', moderationRouter);           // moderation_queue over listings
  router.use('/auctions', adminAuctionsRouter);          // also imports triggerSettlement
  router.use('/disputes', disputesRouter);               // imports refundSettlement
  router.use('/escrow', escrowRouter);
  router.use('/seller-verification', sellerVerificationRouter); // legacy S3 KYC, superseded by Yoti
}

export default router;
