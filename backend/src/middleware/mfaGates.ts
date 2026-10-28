/**
 * S-2FA route gates. Run after requireAuth (or verifyAdminAuth): both verify the
 * token with GoTrue first, which is what makes reading its claims safe here.
 *
 *   requireSecondFactor(gate)  this session passed its second factor (lib/mfa/policy.ts)
 *   requireStepUp(action, target)  a fresh, single-use passkey check for this exact action
 *                                  and target, sent as `X-Step-Up` (flag FEATURE_REQUIRE_STEP_UP,
 *                                  or always when `always` is set)
 *
 * Refusals use the house envelope plus a closed-set `reason` the frontend branches on.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { isStepUpRequired } from '../lib/featureFlags';
import { twoFactorPolicy } from '../lib/mfa/policy';
import { readVerifiedClaims } from '../lib/mfa/jwtClaims';
import { consumeStepUp, hasSecondFactor, type Caller } from '../lib/mfa/mfaService';
import type { StepUpAction } from '../lib/mfa/store';
import { emitSecurityEvent } from '../lib/security/securityEvent';
import { securityContext, type ActorType } from '../lib/security/requestContext';
import { log } from '../lib/logger';
import { activeFreeze, FREEZE_MESSAGE } from '../lib/mfa/recoveryState';

type AnyReq = Request & { user?: { id: string; email?: string | null }; admin?: { admin_id: string; email: string }; requestId?: string };

/** The signed-in caller, from requireAuth (`req.user`) or verifyAdminAuth (`req.admin`). */
export const callerFrom = (req: AnyReq, actorType: ActorType = 'user'): Caller | null => {
  const userId = req.user?.id ?? req.admin?.admin_id;
  if (!userId) return null;
  const { sessionId, sub } = readVerifiedClaims(req.headers.authorization);
  // The token's subject must be the account the middleware verified.
  if (sub !== userId) return null;
  const route = `${req.baseUrl}${(req.route as { path?: string } | undefined)?.path ?? ''}` || 'unknown';
  return {
    userId,
    sessionId,
    email: req.user?.email ?? req.admin?.email ?? null,
    log: { ...securityContext(req as never, route, actorType), actorId: userId },
  };
};

const deny = (res: Response, status: number, error: string, code: string): void => {
  res.status(status).json({ success: false, data: null, error, code, reason: code });
};

export const requireSecondFactor =
  (gate: 'token_action' | 'admin' = 'token_action'): RequestHandler =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const caller = callerFrom(req as AnyReq);
      // Ph4: everyone (FEATURE_REQUIRE_2FA), or staff / Creators under their own flags.
      const userId = (req as AnyReq).user?.id ?? (req as AnyReq).admin?.admin_id;
      if (userId && !(await twoFactorPolicy(userId)).forTokenActions) return next();
      const ok = caller ? await hasSecondFactor(caller.userId, caller.sessionId) : false;
      if (caller) {
        emitSecurityEvent({
          event: 'auth.2fa_gate',
          gate,
          outcome: ok ? 'passed' : caller.sessionId ? 'failed' : 'missing',
          result: ok ? 'ok' : '2fa_required',
          request_id: caller.log.requestId,
          actor_id: caller.log.actorId,
          actor_type: caller.log.actorType,
          ip: caller.log.ip,
          route: caller.log.route,
        });
      }
      if (!ok) return deny(res, 403, 'Confirm it is you with your passkey or code first', '2fa_required');
      return next();
    } catch (err) {
      // Fail closed: a database error never lets a request through.
      log.error('mfa_gate_failed', { error: err instanceof Error ? err.message.slice(0, 200) : 'unknown' });
      return deny(res, 503, 'Service temporarily unavailable', 'unavailable');
    }
  };

export const STEP_UP_HEADER = 'x-step-up';

export const requireStepUp =
  (action: StepUpAction, targetOf: (req: Request) => unknown, opts: { always?: boolean } = {}): RequestHandler =>
  async (req: Request, res: Response, next: NextFunction) => {
    if (!opts.always && !isStepUpRequired()) return next();
    try {
      const caller = callerFrom(req as AnyReq);
      const target = targetOf(req);
      const header = req.get(STEP_UP_HEADER);
      const ok =
        caller !== null &&
        typeof target === 'string' &&
        target.length > 0 &&
        target.length <= 200 &&
        (await consumeStepUp(caller, header, action, target));
      if (!ok) return deny(res, 403, 'Confirm it is you with your passkey to continue', 'step_up_required');
      return next();
    } catch (err) {
      log.error('step_up_gate_failed', { error: err instanceof Error ? err.message.slice(0, 200) : 'unknown' });
      return deny(res, 503, 'Service temporarily unavailable', 'unavailable');
    }
  };

/**
 * S-2FA Ph3b: refuses token actions during the 7 days after an email-code
 * recovery (transfer start + accept, release, re-issue request). Always on,
 * flag or not: a freeze only exists after a recovery. Runs before any step-up
 * so a refused request never spends one. Fails closed.
 */
export const refuseWhileFrozen: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const caller = callerFrom(req as AnyReq);
    if (!caller) return deny(res, 401, 'Authentication required', 'unauthenticated');
    const until = await activeFreeze(caller.userId);
    if (!until) return next();
    emitSecurityEvent({
      event: 'auth.mfa',
      action: 'recovery_freeze_block',
      method: null,
      step_up_action: null,
      break_glass: false,
      result: 'recovery_freeze',
      request_id: caller.log.requestId,
      actor_id: caller.log.actorId,
      actor_type: caller.log.actorType,
      ip: caller.log.ip,
      route: caller.log.route,
    });
    res.status(403).json({ success: false, data: null, error: FREEZE_MESSAGE, code: 'recovery_freeze', reason: 'recovery_freeze', freezeEndsAt: until });
  } catch (err) {
    log.error('recovery_freeze_gate_failed', { error: err instanceof Error ? err.message.slice(0, 200) : 'unknown' });
    return deny(res, 503, 'Service temporarily unavailable', 'unavailable');
  }
};
