/**
 * 2FA gate for origin claim and transfer completion — S-NFC3, rewired in S-2FA.
 *
 * The locked lifecycle decision: "every account needs 2FA". Enforcement is
 * per account by lib/mfa/policy.ts (FEATURE_REQUIRE_2FA for everyone; staff and
 * Creators under their own flags), default off until S-2FA Ph4.
 *
 * S-2FA: the check is our own per-session marker (`mfa_sessions`, keyed on the
 * JWT `session_id` claim), written when the caller passes a passkey, an
 * authenticator code or a backup code. It is NOT Supabase's `aal2`: we do not
 * use Supabase's MFA factors (Boss, 2026-10-27).
 */

import type { Request } from 'express';
import { emitSecurityEvent } from './securityEvent';
import type { SecurityLogContext } from '../ownership/ownershipProof';
import { twoFactorPolicy } from '../mfa/policy';
import { readVerifiedClaims } from '../mfa/jwtClaims';
import { hasSecondFactor, hasStaffSecondFactor } from '../mfa/mfaService';

export type TwoFactorGate = 'claim' | 'transfer_complete';

/**
 * True when this request's session has a live second-factor marker. Fails
 * closed: a database error reads as "not verified".
 */
export const sessionHasSecondFactor = async (
  authHeader: string | undefined,
  userId: string | null,
  opts: { staff?: boolean } = {},
): Promise<boolean> => {
  if (!userId) return false;
  const { sessionId, sub } = readVerifiedClaims(authHeader);
  if (!sessionId || sub !== userId) return false;
  try {
    // S-2FA Ph3b review L4: an email-recovery marker never opens the admin console.
    return opts.staff ? await hasStaffSecondFactor(userId, sessionId) : await hasSecondFactor(userId, sessionId);
  } catch {
    return false;
  }
};

/**
 * Returns true when the caller may proceed.
 *
 * Always emits `auth.2fa_gate`, including when the flag is off — S-SEC0 needs
 * to see that the gate was evaluated, and the `passed` volume with the flag off
 * is what will show how many claims would break if it were switched on early.
 */
export const passesTwoFactor = async (
  req: Request,
  gate: TwoFactorGate,
  ctx: SecurityLogContext,
): Promise<boolean> => {
  // Ph4: lib/mfa/policy.ts. A database error reads as "required" (fail closed).
  let required = true;
  if (ctx.actorId) {
    try {
      required = (await twoFactorPolicy(ctx.actorId)).forTokenActions;
    } catch {
      required = true;
    }
  }
  const { sessionId } = readVerifiedClaims(req.headers.authorization);
  const verified = required ? await sessionHasSecondFactor(req.headers.authorization, ctx.actorId) : false;
  const satisfied = !required || verified;

  emitSecurityEvent({
    event: 'auth.2fa_gate',
    gate,
    outcome: satisfied ? 'passed' : sessionId === null ? 'missing' : 'failed',
    result: satisfied ? 'ok' : '2fa_required',
    request_id: ctx.requestId,
    actor_id: ctx.actorId,
    actor_type: ctx.actorType,
    ip: ctx.ip,
    route: ctx.route,
  });

  return satisfied;
};
