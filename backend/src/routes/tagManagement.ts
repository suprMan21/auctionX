/**
 * S-NFC3 tag-management routes, mounted into the existing /api/v1/nfc router.
 *
 * Kept in their own module so the S-NFC3 surface is inspectable as a unit and
 * so `routes/nfc.ts` stays a mount list rather than growing a second identity.
 */

import { Router, RequestHandler, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth';
import { AppError, toAppError } from '../lib/errors';
import {
  enrollTag,
  enrollPrecheck,
  claimTag,
  initiateTransfer,
  completeTransfer,
  cancelTransfer,
  releaseTag,
  replaceTag,
  requestReissue,
  updateDisclosure,
} from '../controllers/tagManagementController';
import { ownershipAuthProbeDetector, resolveOwnershipId } from '../controllers/ownershipController';

/**
 * Wraps an async handler so a thrown AppError becomes the project's standard
 * `{ success, data, error }` envelope.
 *
 * The shared `errorHandler` emits `{ error, requestId }` instead, which every
 * parked marketplace route already depends on — changing it would be a
 * cross-cutting edit well outside this session. Wrapping here keeps the new
 * surface compliant without touching parked behaviour.
 */
const SUN_REASONS = new Set(['replay_detected', 'invalid_signature']);

const sunReason = (details: unknown): string | null => {
  if (!details || typeof details !== 'object') return null;
  const reason = (details as { reason?: unknown }).reason;
  return typeof reason === 'string' && SUN_REASONS.has(reason) ? reason : null;
};

const handle =
  (fn: (req: never, res: Response) => Promise<unknown>): RequestHandler =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req as never, res);
    } catch (err) {
      const appError: AppError = toAppError(err);
      if (res.headersSent) return next(err);
      // S-NFC3.5: a failed SUN check carries a closed-set `reason`
      // (`replay_detected` | `invalid_signature`). Nothing else from
      // `details` is ever echoed.
      const reason = sunReason(appError.details);
      res.status(appError.status).json({
        success: false,
        data: null,
        error: appError.message,
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

export const tagManagementRoutes = Router();

// Every route runs the probe detector first: an Ownership ID or Receipt
// submitted where authority is expected is logged, never honoured.
tagManagementRoutes.use(ownershipAuthProbeDetector as unknown as RequestHandler);

// ── Static routes, ALL before any parameterized route (lesson #5) ────────────
tagManagementRoutes.post('/enroll', requireAuth, mutationLimit, handle(enrollTag));
tagManagementRoutes.get('/enroll/precheck/:tagUid', requireAuth, mutationLimit, handle(enrollPrecheck));
tagManagementRoutes.post('/claim', requireAuth, mutationLimit, handle(claimTag));
tagManagementRoutes.post('/release', requireAuth, mutationLimit, handle(releaseTag));
tagManagementRoutes.post('/replace', requireAuth, mutationLimit, handle(replaceTag));
tagManagementRoutes.post('/reissue-request', requireAuth, mutationLimit, handle(requestReissue));

// `/transfer/initiate` MUST be registered before `/transfer/:id/...`, otherwise
// Express matches "initiate" as an `:id`.
tagManagementRoutes.post('/transfer/initiate', requireAuth, mutationLimit, handle(initiateTransfer));
tagManagementRoutes.post('/transfer/:id/complete', requireAuth, mutationLimit, handle(completeTransfer));
tagManagementRoutes.post('/transfer/:id/cancel', requireAuth, mutationLimit, handle(cancelTransfer));

// ── Parameterized route LAST ────────────────────────────────────────────────
tagManagementRoutes.patch('/:tagId/disclosure', requireAuth, mutationLimit, handle(updateDisclosure));

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
// resolves to is public. Signing in only adds the "you own this" flag.
ownershipRoutes.get('/:ownershipId', lookupLimit, handle(resolveOwnershipId));
