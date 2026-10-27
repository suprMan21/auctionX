/**
 * S-2FA routes, mounted at /api/v1/auth/mfa (app.ts TOKEN_MOUNTS).
 *
 * Every route is signed-in only. Rate limits key on the account, so a guesser
 * cannot spread attempts across addresses; the code lockout (5 wrong,
 * 15 minutes) sits underneath in the database. The code-check routes also
 * share one per-IP budget (Ph2), so one address cannot grind across many
 * accounts. The IP comes from `trust proxy` (app.ts TRUSTED_PROXIES), and
 * express-rate-limit 8's default key groups IPv6 addresses by /56.
 */

import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth';
import { requireStepUp } from '../middleware/mfaGates';
import { handle } from './tagManagement';
import {
  deletePasskey,
  deleteTotp,
  getMfaStatus,
  patchPasskey,
  postRegenerateCodes,
  postRegisterOptions,
  postRegisterVerify,
  postSignInOptions,
  postSignInVerify,
  postStepUpOptions,
  postStepUpVerify,
  postTotpConfirm,
  postTotpSetup,
} from '../controllers/mfaController';

const byAccount = (max: number) =>
  rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // requireAuth runs first, so req.user is always set here.
    keyGenerator: (req: Request) => `mfa:${(req as Request & { user?: { id: string } }).user?.id ?? 'anon'}`,
    message: { success: false, data: null, error: 'Too many attempts. Please slow down.' },
  });

export const MFA_IP_LIMIT_PER_MIN = 30;

/**
 * One shared budget across every code-check route, per client IP. Runs BEFORE
 * requireAuth so junk tokens cannot be used to hammer GoTrue either.
 */
const codeCheckIpLimit = rateLimit({
  windowMs: 60 * 1000,
  max: MFA_IP_LIMIT_PER_MIN,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, data: null, error: 'Too many attempts. Please slow down.' },
});

const verifyLimit = byAccount(10);
const generalLimit = byAccount(30);

const router = Router();

router.get('/status', requireAuth, generalLimit, handle(getMfaStatus));

router.post('/passkeys/register/options', requireAuth, generalLimit, handle(postRegisterOptions));
router.post('/passkeys/register/verify', codeCheckIpLimit, requireAuth, verifyLimit, handle(postRegisterVerify));
router.patch('/passkeys/:id', requireAuth, generalLimit, handle(patchPasskey));
// Removing a sign-in method always needs a fresh passkey check, flag or not.
router.delete(
  '/passkeys/:id',
  codeCheckIpLimit,
  requireAuth,
  verifyLimit,
  requireStepUp('factor_remove', (req) => `passkey:${req.params.id}`, { always: true }),
  handle(deletePasskey),
);

router.post('/sign-in/options', requireAuth, generalLimit, handle(postSignInOptions));
router.post('/sign-in/verify', codeCheckIpLimit, requireAuth, verifyLimit, handle(postSignInVerify));

router.post('/step-up/options', requireAuth, generalLimit, handle(postStepUpOptions));
router.post('/step-up/verify', codeCheckIpLimit, requireAuth, verifyLimit, handle(postStepUpVerify));

router.post('/totp/setup', requireAuth, generalLimit, handle(postTotpSetup));
router.post('/totp/confirm', codeCheckIpLimit, requireAuth, verifyLimit, handle(postTotpConfirm));
router.delete(
  '/totp',
  codeCheckIpLimit,
  requireAuth,
  verifyLimit,
  requireStepUp('factor_remove', () => 'totp', { always: true }),
  handle(deleteTotp),
);

router.post('/recovery-codes/regenerate', codeCheckIpLimit, requireAuth, verifyLimit, handle(postRegenerateCodes));

export default router;
