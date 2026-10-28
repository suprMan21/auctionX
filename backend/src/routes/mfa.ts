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

import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth';
import { requireStepUp } from '../middleware/mfaGates';
import { handle } from './tagManagement';
import {
  deleteBackupEmail,
  getRecovery,
  postBackupEmail,
  postBackupEmailVerify,
  postRecoveryCancel,
  postRecoveryCode,
  postRecoveryFinish,
  postRecoveryStart,
  postRecoveryUndo,
  preBackupEmailAdd,
  preBackupEmailRemove,
  preRecoveryUndo,
  deletePasskey,
  deleteTotp,
  getMfaStatus,
  patchPasskey,
  postAccountChange,
  postRegenerateCodes,
  postRegisterOptions,
  postRegisterVerify,
  postSignInOptions,
  postSignInVerify,
  postStepUpOptions,
  postStepUpVerify,
  postTotpConfirm,
  postTotpSetup,
  preAccountChange,
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

/**
 * A pre-check that may refuse (house envelope + reason, via `handle`) or pass
 * on to the next middleware.
 */
const handleThen =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let passed = false;
    await handle(async (r: never, s: Response) => {
      await fn(r, s, () => {
        passed = true;
      });
    })(req, res, next);
    // Called outside `handle`, so a later middleware's failure is never answered twice.
    if (passed && !res.headersSent) next();
  };

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

/**
 * Ph2b: a single-use, 2-minute permit for a password change or an email-change
 * request, which GoTrue otherwise refuses for an account with a second factor
 * (auth.users trigger guard_auth_change). Needs this session's marker and a
 * fresh `account_change` step-up whose target is the kind, flag or not.
 */
router.post(
  '/account-change',
  codeCheckIpLimit,
  requireAuth,
  verifyLimit,
  handleThen(preAccountChange),
  requireStepUp('account_change', (req) => (req.body as { kind?: unknown } | undefined)?.kind, { always: true }),
  handle(postAccountChange),
);

router.post('/recovery-codes/regenerate', codeCheckIpLimit, requireAuth, verifyLimit, handle(postRegenerateCodes));

// ── Ph3b: email-code recovery + backup email ────────────────────────────────
// Sends are limited in the database too (60 s, 3 an hour, 10 a day per
// account); this per-minute cap only stops a tight loop before it gets there.
const sendLimit = byAccount(5);

router.get('/recovery', requireAuth, generalLimit, handle(getRecovery));
router.post('/recovery/code', codeCheckIpLimit, requireAuth, sendLimit, handle(postRecoveryCode));
router.post('/recovery/start', codeCheckIpLimit, requireAuth, verifyLimit, handle(postRecoveryStart));
router.post('/recovery/finish', codeCheckIpLimit, requireAuth, verifyLimit, handle(postRecoveryFinish));
router.post('/recovery/cancel', requireAuth, generalLimit, handle(postRecoveryCancel));
// Undo needs a step-up with a method the account had before the recovery,
// bound to this recovery id (mfaService refuses a recovery-added method).
router.post(
  '/recovery/undo',
  codeCheckIpLimit,
  requireAuth,
  verifyLimit,
  handleThen(preRecoveryUndo),
  requireStepUp('recovery_undo', (req) => (req.body as { recoveryId?: unknown } | undefined)?.recoveryId, { always: true }),
  handle(postRecoveryUndo),
);
router.post(
  '/backup-email',
  codeCheckIpLimit,
  requireAuth,
  sendLimit,
  handleThen(preBackupEmailAdd),
  requireStepUp('recovery_channel', () => 'backup_email', { always: true }),
  handle(postBackupEmail),
);
router.post('/backup-email/verify', codeCheckIpLimit, requireAuth, verifyLimit, handle(postBackupEmailVerify));
router.delete(
  '/backup-email',
  codeCheckIpLimit,
  requireAuth,
  verifyLimit,
  handleThen(preBackupEmailRemove),
  requireStepUp('recovery_channel', () => 'backup_email', { always: true }),
  handle(deleteBackupEmail),
);

export default router;
