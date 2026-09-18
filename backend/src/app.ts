import express, { Router } from 'express';
import cors from 'cors';
import { requestIdMiddleware } from './middleware/requestId';
import { errorHandler } from './middleware/errorHandler';
import { isMarketplaceEnabled } from './lib/featureFlags';

// ── Token-platform routers (always mounted) ──────────────────────────────────
import healthRoutes from './routes/health';
import { nfcRoutes } from './routes/nfc';
import { publicVerificationRoutes } from './routes/verifications';
import yotiVerificationRoutes from './routes/yotiVerification';
import yotiWebhookRoutes from './routes/yotiWebhook';
import notificationRoutes from './routes/notifications';
import adminRoutes from './routes/admin/index';

// ── Parked marketplace routers (mounted only when FEATURE_MARKETPLACE=true) ──
// Imported unconditionally so `tsc --noEmit` keeps typechecking the parked code.
// S-ISO1 deletes NOTHING.
import auctionRoutes from './routes/auctions';
import settlementRoutes from './routes/settlements';
import deliveryRoutes from './routes/delivery';
import payoutRoutes from './routes/payouts';
import stripeConnectRoutes from './routes/stripeConnect';
import stripeAccountWebhookRoutes from './routes/stripeAccountWebhook';
import webhookRoutes from './routes/webhooks';
import searchRoutes from './routes/search';
import { verificationRoutes } from './routes/verifications';
import { sellerVerificationRoutes } from './routes/sellerVerification';
import messageRoutes from './routes/messages';

/**
 * A router mount. `raw: true` means the router needs the unparsed request body
 * (webhook signature verification) and must therefore be mounted BEFORE the
 * global express.json() parser.
 */
type Mount = { readonly path: string; readonly router: Router; readonly raw?: boolean };

/**
 * ALLOWLIST — the token platform's public surface.
 *
 * This is deliberately an allowlist and not a denylist: a router that is not
 * named here is never mounted, so a newly added parked route cannot leak into
 * production by omission. Adding an entry is a deliberate act.
 */
export const TOKEN_MOUNTS: readonly Mount[] = [
  { path: '/api/v1/webhooks/yoti', router: yotiWebhookRoutes, raw: true },
  { path: '/api/v1/verification', router: yotiVerificationRoutes },
  { path: '/api/v1/nfc', router: nfcRoutes },
  { path: '/api/v1/verify', router: publicVerificationRoutes },
  { path: '/api/v1/notifications', router: notificationRoutes },
  { path: '/api/v1/admin', router: adminRoutes },
] as const;

/**
 * PARKED — marketplace + Unmentionables. Mounted only when FEATURE_MARKETPLACE
 * is on. Nothing here is deleted; see docs/PARKED_MARKETPLACE.md for the full
 * reversal procedure (two flags, one edge-function secret, two SQL scripts).
 */
export const MARKETPLACE_MOUNTS: readonly Mount[] = [
  { path: '/api/v1/webhooks/stripe-account', router: stripeAccountWebhookRoutes, raw: true },
  { path: '/api/v1/auctions', router: auctionRoutes },
  { path: '/api/v1/settlements', router: settlementRoutes },
  { path: '/api/v1/delivery', router: deliveryRoutes },
  { path: '/api/v1/payouts', router: payoutRoutes },
  { path: '/api/v1/stripe-connect', router: stripeConnectRoutes },
  { path: '/api/v1/webhooks', router: webhookRoutes },
  { path: '/api/v1/search', router: searchRoutes },
  { path: '/api/v1/verifications', router: verificationRoutes },
  { path: '/api/v1/seller-verification', router: sellerVerificationRoutes },
  { path: '/api/v1/conversations', router: messageRoutes },
] as const;

/**
 * Builds the Express app.
 *
 * Extracted from server.ts so the mount allowlist is supertest-able: server.ts
 * only listens.
 */
export const createApp = (): express.Express => {
  const app = express();
  const marketplace = isMarketplaceEnabled();

  app.use(requestIdMiddleware as express.RequestHandler);
  app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  }));

  // Health before the body parsers and every downstream middleware, so a
  // liveness probe can never be blocked by them (Lesson: health endpoint must
  // come before all middleware).
  app.use('/api/v1', healthRoutes);

  const mounts = marketplace ? [...TOKEN_MOUNTS, ...MARKETPLACE_MOUNTS] : TOKEN_MOUNTS;

  // Raw-body mounts MUST precede express.json() — signature verification needs
  // the unparsed bytes.
  for (const { path, router, raw } of mounts) {
    if (raw) app.use(path, express.raw({ type: 'application/json' }), router);
  }

  app.use(express.json());

  for (const { path, router, raw } of mounts) {
    if (!raw) app.use(path, router);
  }

  app.use((_req, res) => { res.status(404).json({ error: 'Not found' }); });
  app.use(errorHandler);

  return app;
};
