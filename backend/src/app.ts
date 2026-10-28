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
import tokenFeeWebhookRoutes from './routes/tokenFeeWebhook';
import tokenFeeSweepRoutes from './routes/tokenFeeSweep';
import anchorTickRoutes from './routes/anchorTick';
import mfaRoutes from './routes/mfa';
import { ownershipRoutes } from './routes/tagManagement';
import { earlyAccessRoutes } from './routes/earlyAccess';

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
import { appConfigRoutes } from './routes/appConfig';
import { appVersionGate } from './middleware/appVersionGate';

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
  // S-NFC3: the normal path that completes a token transfer. Raw body for
  // signature verification, and its OWN signing secret.
  { path: '/api/v1/webhooks/stripe-token-fees', router: tokenFeeWebhookRoutes, raw: true },
  // S-ADMIN1 Ph3a: the 10-minute reconciliation tick (pg_cron, shared secret).
  { path: '/api/v1/internal/token-fee-sweep', router: tokenFeeSweepRoutes },
  // S-ANCHOR1 Ph1: the hourly anchoring tick (pg_cron, its own shared secret).
  { path: '/api/v1/internal/anchor-tick', router: anchorTickRoutes },
  { path: '/api/v1/verification', router: yotiVerificationRoutes },
  { path: '/api/v1/nfc', router: nfcRoutes },
  { path: '/api/v1/ownership', router: ownershipRoutes },
  { path: '/api/v1/verify', router: publicVerificationRoutes },
  { path: '/api/v1/notifications', router: notificationRoutes },
  { path: '/api/v1/admin', router: adminRoutes },
  // S-2FA: passkeys, authenticator app, backup codes, step-up.
  { path: '/api/v1/auth/mfa', router: mfaRoutes },
  // S-SITE2 G3: early-access signup, the one call the public site makes.
  { path: '/api/v1/early-access', router: earlyAccessRoutes },
  // S-MOB1: the Creator app's minimum version + store links (public).
  { path: '/api/v1/app-config', router: appConfigRoutes },
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
 * Proxies whose `X-Forwarded-For` entries Express may believe: App Runner's
 * internal hops, which are all link-local (169.254/16) or private addresses.
 *
 * Express reads X-Forwarded-For from the RIGHT, skips these, and takes the
 * first public address as `req.ip`. That holds whatever the number of App
 * Runner hops, and a client cannot choose its own IP: anything it sends sits to
 * the left of the address App Runner appended. Deliberately not `true` (which
 * would believe the left-most, client-written entry) and not a hop count (App
 * Runner does not document one).
 *
 * Every rate limiter keys on `req.ip`; unset, they all saw the proxy's address
 * and shared one budget across every user (unset since 2026-10-05).
 */
export const TRUSTED_PROXIES = ['loopback', 'linklocal', 'uniquelocal'] as const;

const EARLY_ACCESS_PATH = '/api/v1/early-access';

/** Origins allowed to call the early-access signup: the public site (+ www) and the app. */
export const earlyAccessOrigins = (): string[] => {
  const configured = (process.env.EARLY_ACCESS_ORIGINS ?? 'https://authentic-materials.com,https://www.authentic-materials.com')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return [...configured, process.env.FRONTEND_URL || 'http://localhost:5173'];
};

/**
 * CORS: the app origin everywhere, with credentials. The early-access path alone also
 * accepts the public site, without credentials (it is anonymous).
 */
const corsFor: cors.CorsOptionsDelegate<cors.CorsRequest> = (req, cb) => {
  const { originalUrl, url: rawUrl } = req as unknown as { originalUrl?: string; url?: string };
  const url = originalUrl ?? rawUrl ?? '';
  if (url === EARLY_ACCESS_PATH || url.startsWith(`${EARLY_ACCESS_PATH}/`) || url.startsWith(`${EARLY_ACCESS_PATH}?`)) {
    cb(null, { origin: earlyAccessOrigins(), credentials: false, methods: ['POST'], maxAge: 600 });
    return;
  }
  cb(null, { origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true });
};

/**
 * Builds the Express app.
 *
 * Extracted from server.ts so the mount allowlist is supertest-able: server.ts
 * only listens.
 */
export const createApp = (): express.Express => {
  const app = express();
  app.set('trust proxy', [...TRUSTED_PROXIES]);
  const marketplace = isMarketplaceEnabled();

  app.use(requestIdMiddleware as express.RequestHandler);
  app.use(cors(corsFor));

  // Health before the body parsers and every downstream middleware, so a
  // liveness probe can never be blocked by them (Lesson: health endpoint must
  // come before all middleware).
  app.use('/api/v1', healthRoutes);

  // S-MOB1: refuse Creator-app builds below the minimum version. Requests
  // without the app's headers (website, webhooks, cron) pass untouched.
  app.use('/api/v1', appVersionGate);

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
