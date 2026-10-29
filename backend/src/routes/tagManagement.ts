/**
 * S-NFC3 tag-management routes, mounted into the existing /api/v1/nfc router.
 *
 * Kept in their own module so the S-NFC3 surface is inspectable as a unit and
 * so `routes/nfc.ts` stays a mount list rather than growing a second identity.
 */

import { Router, RequestHandler, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { refuseWhileFrozen, requireSecondFactor, requireStepUp } from '../middleware/mfaGates';
import { AppError, toAppError } from '../lib/errors';
import { log } from '../lib/logger';
import {
  enrollTag,
  enrollPrecheck,
  reserveChipName,
  claimTag,
  initiateTransfer,
  completeTransfer,
  cancelTransfer,
  releaseTag,
  requestReissue,
  reissuePhotoUrl,
  listMyReissueRequests,
  payReissue,
  cancelReissue,
  updateDisclosure,
} from '../controllers/tagManagementController';
import { ownershipAuthProbeDetector, resolveOwnershipId } from '../controllers/ownershipController';
import { getMyVouchers, getPrices } from '../controllers/tokenPricesController';
import { getShareImage } from '../controllers/sealShareController';
import {
  tapTag,
  listMyTokens,
  listIncomingTransfers,
  getTransfer,
  getReceipt,
} from '../controllers/tokenReadController';

/**
 * Wraps an async handler so a thrown AppError becomes the project's standard
 * `{ success, data, error }` envelope.
 *
 * The shared `errorHandler` emits `{ error, requestId }` instead, which every
 * parked marketplace route already depends on — changing it would be a
 * cross-cutting edit well outside this session. Wrapping here keeps the new
 * surface compliant without touching parked behaviour.
 */
/**
 * Closed set of machine-readable reasons a client may branch on. S-NFC3.5 added
 * the SUN pair; S-NFC3-FE adds the lifecycle codes and `tap_session_invalid`
 * so the frontend never has to pattern-match human error text.
 */
const CLIENT_REASONS = new Set([
  'replay_detected',
  'invalid_signature',
  'tap_session_invalid',
  'already_claimed',
  'token_released',
  'token_retired',
  'token_suspended',
  'transfer_pending',
  '2fa_required',
  // S-2FA (lib/mfa/mfaService.ts MfaReason)
  'second_factor_required',
  'step_up_required',
  'mfa_locked',
  'invalid_code',
  'passkey_invalid',
  'synced_passkey_not_allowed',
  'last_factor',
  'already_set_up',
  'no_passkey',
  'not_available',
  // S-2FA Ph2: staff confirm token actions with a passkey only; a backup code
  // never confirms a token action.
  'passkey_required',
  'backup_code_not_allowed',
  // S-2FA review M1: a method added with a code waits 24 h before it can
  // confirm a step-up.
  'new_method_waiting',
  // S-2FA Ph3b: email-code recovery (lib/mfa/mfaService.ts MfaReason).
  'recovery_freeze',
  'recovery_not_available',
  'recovery_waiting',
  'recovery_method_not_allowed',
  'code_expired',
  'code_locked',
  'code_send_limit',
  'mail_unavailable',
  'nonce_required',
  'same_as_account_email',
]);

const sunReason = (details: unknown): string | null => {
  if (!details || typeof details !== 'object') return null;
  const reason = (details as { reason?: unknown }).reason;
  return typeof reason === 'string' && CLIENT_REASONS.has(reason) ? reason : null;
};

export const handle =
  (fn: (req: never, res: Response) => Promise<unknown>): RequestHandler =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req as never, res);
    } catch (err) {
      const appError: AppError = toAppError(err);
      if (res.headersSent) return next(err);
      // An unexpected (non-AppError) failure must be visible in the logs: the
      // client only ever sees "Internal server error". 2026-10-09: a re-issue
      // photo-URL failure returned 500 twice and left no trace at all.
      // Route pattern + error name/message only, never the request body.
      if (!(err instanceof AppError)) {
        log.error('unhandled_route_error', {
          route: `${req.baseUrl}${(req.route as { path?: string } | undefined)?.path ?? ''}`,
          requestId: (req as Request & { requestId?: string }).requestId ?? null,
          errorName: err instanceof Error ? err.name : typeof err,
          error: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
        });
      }
      // A closed-set `reason` (CLIENT_REASONS) is the only thing from
      // `details` that is ever echoed.
      const reason = sunReason(appError.details);
      // A non-AppError (thrown by a library or a missing config) carries an
      // internal message; never send it to the client. 2026-10-03: a claim
      // returned "OWNERSHIP_SALT_KEY is not set …" verbatim.
      const message = err instanceof AppError ? appError.message : 'Internal server error';
      res.status(appError.status).json({
        success: false,
        data: null,
        error: message,
        code: appError.code,
        ...(reason ? { reason } : {}),
      });
    }
  };

/**
 * Ownership-mutating routes are rate limited harder than reads: claim and
 * transfer completion are the surfaces where a scripted attacker would grind
 * against SUN counters or probe for IDOR.
 */
const mutationLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, data: null, error: 'Too many requests. Please slow down.' },
});

/** Public tap verification: same budget as the legacy POST /nfc/scan. */
const tapLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, data: null, error: 'Too many scan requests. Please slow down.' },
});

/** Signed-in reads (My Tokens, transfer polling). Polling needs headroom. */
const readLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, data: null, error: 'Too many requests. Please slow down.' },
});

export const tagManagementRoutes = Router();

// Every route runs the probe detector first: an Ownership ID or Receipt
// submitted where authority is expected is logged, never honoured.
tagManagementRoutes.use(ownershipAuthProbeDetector as unknown as RequestHandler);

// ── Static routes, ALL before any parameterized route (lesson #5) ────────────
tagManagementRoutes.post('/enroll', requireAuth, mutationLimit, handle(enrollTag));
tagManagementRoutes.get('/enroll/precheck/:tagUid', requireAuth, mutationLimit, handle(enrollPrecheck));
tagManagementRoutes.post('/enroll/reserve-name', requireAuth, mutationLimit, handle(reserveChipName));
tagManagementRoutes.post('/claim', requireAuth, mutationLimit, handle(claimTag));
// S-2FA: release ends a token for good, so it needs the second factor AND a
// fresh passkey check for this exact token (typed RELEASE stays as well).
tagManagementRoutes.post(
  '/release',
  requireAuth,
  mutationLimit,
  requireSecondFactor(),
  refuseWhileFrozen,
  requireStepUp('release', (req) => (req.body as { tagId?: unknown } | undefined)?.tagId),
  handle(releaseTag),
);
// S-ADMIN1: the non-atomic owner/staff replace is gone. The token reset is
// admin-only and transactional at POST /api/v1/admin/tags/:tagId/reset. 410
// (not 404) so an old client or script learns the endpoint moved on purpose.
tagManagementRoutes.post('/replace', requireAuth, mutationLimit, (_req: Request, res: Response) => {
  res.status(410).json({
    success: false,
    data: null,
    error: 'This endpoint was removed. Token resets are performed by an administrator.',
    code: 'gone',
  });
});
// S-ADMIN1 Ph2 re-issue (owner side). The `/reissue-requests/...` prefix
// cannot collide with `/:tagId/...` below: those need a second segment of
// `disclosure` or `receipt`.
tagManagementRoutes.post('/reissue-request/photo-url', requireAuth, mutationLimit, requireSecondFactor(), refuseWhileFrozen, handle(reissuePhotoUrl));
tagManagementRoutes.post('/reissue-request', requireAuth, mutationLimit, requireSecondFactor(), refuseWhileFrozen, handle(requestReissue));
tagManagementRoutes.get('/reissue-requests/mine', requireAuth, readLimit, handle(listMyReissueRequests));
tagManagementRoutes.post('/reissue-requests/:id/pay', requireAuth, mutationLimit, requireSecondFactor(), refuseWhileFrozen, handle(payReissue));
tagManagementRoutes.post('/reissue-requests/:id/cancel', requireAuth, mutationLimit, requireSecondFactor(), refuseWhileFrozen, handle(cancelReissue));

// S-NFC3-FE reads. `/tap` is public (optional auth personalises it); the rest
// are the caller's own data.
tagManagementRoutes.post('/tap', optionalAuth, tapLimit, handle(tapTag));
tagManagementRoutes.get('/mine', requireAuth, readLimit, handle(listMyTokens));
// S-ADMIN1 Ph3b: prices in effect and the caller's free transfers (display only).
tagManagementRoutes.get('/prices', requireAuth, readLimit, handle(getPrices));
tagManagementRoutes.get('/vouchers/mine', requireAuth, readLimit, handle(getMyVouchers));
tagManagementRoutes.get('/transfers/incoming', requireAuth, readLimit, handle(listIncomingTransfers));

// `/transfer/initiate` MUST be registered before `/transfer/:id/...`, otherwise
// Express matches "initiate" as an `:id`.
tagManagementRoutes.post('/transfer/initiate', requireAuth, mutationLimit, requireSecondFactor(), refuseWhileFrozen, handle(initiateTransfer));
// The second-factor check for completion runs inside the controller (it emits
// the transfer event); the passkey step-up is bound to this transfer id.
tagManagementRoutes.post(
  '/transfer/:id/complete',
  requireAuth,
  mutationLimit,
  refuseWhileFrozen,
  requireStepUp('transfer_complete', (req) => req.params.id),
  handle(completeTransfer),
);
tagManagementRoutes.post('/transfer/:id/cancel', requireAuth, mutationLimit, requireSecondFactor(), refuseWhileFrozen, handle(cancelTransfer));
tagManagementRoutes.get('/transfer/:id', requireAuth, readLimit, handle(getTransfer));

// ── Parameterized route LAST ────────────────────────────────────────────────
tagManagementRoutes.patch('/:tagId/disclosure', requireAuth, mutationLimit, requireSecondFactor(), refuseWhileFrozen, handle(updateDisclosure));
// Two segments, so it cannot collide with routes/nfc.ts `GET /:tagId`.
tagManagementRoutes.get('/:tagId/receipt', requireAuth, readLimit, handle(getReceipt));
// S-SEAL1 Ph2b: the current owner's share picture (PNG, no-store). No step-up: sharing needs none (DR-22).
tagManagementRoutes.get('/:tagId/share-image', requireAuth, readLimit, handle(getShareImage));

// ── Ownership lookup (mounted separately at /api/v1/ownership) ───────────────
export const ownershipRoutes = Router();

const lookupLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, data: null, error: 'Too many requests. Please slow down.' },
});

// Deliberately unauthenticated: an Ownership ID is publishable and the view it
// resolves to is public. Signing in only adds the "you own this" flag, which
// needs optionalAuth to identify the caller (S-NFC3-FE: before it, req.user was
// never set here and the flag was always false).
ownershipRoutes.get('/:ownershipId', optionalAuth, lookupLimit, handle(resolveOwnershipId));
