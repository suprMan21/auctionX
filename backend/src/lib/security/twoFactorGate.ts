/**
 * 2FA gate for origin claim and transfer completion — S-NFC3.
 *
 * The locked lifecycle decision: "Verified email plus a passkey or TOTP 2FA is
 * required before the first claim or transfer completion. No exceptions."
 *
 * ENFORCEMENT IS BEHIND `FEATURE_REQUIRE_2FA`, DEFAULT OFF, and must stay off
 * in production until S-2FA ships. There is currently NO MFA enrollment path
 * anywhere in the product — zero hits for mfa/aal/totp across backend/src,
 * frontend/src and every migration — so switching this on today would make
 * /claim and /transfer/:id/complete unreachable for every user rather than
 * secure. Turning it on before enrollment exists is a self-inflicted outage.
 *
 * Supabase encodes assurance level as the `aal` claim on the access token:
 * `aal1` = password/OTP only, `aal2` = a second factor was verified this
 * session. The claim is read from the token the caller already presented; it is
 * not re-verified here because `requireAuth` has already validated the token's
 * signature via GoTrue.
 */

import type { Request } from 'express';
import { emitSecurityEvent } from './securityEvent';
import type { SecurityLogContext } from '../ownership/ownershipProof';

const truthy = (raw: string | undefined): boolean => raw === 'true' || raw === '1';

export const isTwoFactorRequired = (): boolean => truthy(process.env.FEATURE_REQUIRE_2FA);

export type TwoFactorGate = 'claim' | 'transfer_complete';

/**
 * Reads the `aal` claim from a bearer token without verifying its signature.
 *
 * Safe ONLY because this runs after `requireAuth`, which has already validated
 * the same token against GoTrue. Never call this on an unauthenticated path.
 */
const readAalClaim = (authHeader: string | undefined): string | null => {
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const payload = token.split('.')[1];
  if (!payload) return null;

  try {
    const decoded = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as { aal?: unknown };

    return typeof decoded.aal === 'string' ? decoded.aal : null;
  } catch {
    return null;
  }
};

/**
 * Returns true when the caller may proceed.
 *
 * Always emits `auth.2fa_gate`, including when the flag is off — S-SEC0 needs
 * to see that the gate was evaluated, and the `passed` volume with the flag off
 * is what will show how many claims would break if it were switched on early.
 */
export const passesTwoFactor = (
  req: Request,
  gate: TwoFactorGate,
  ctx: SecurityLogContext,
): boolean => {
  const required = isTwoFactorRequired();
  const aal = readAalClaim(req.headers.authorization);
  const satisfied = !required || aal === 'aal2';

  emitSecurityEvent({
    event: 'auth.2fa_gate',
    gate,
    outcome: satisfied ? 'passed' : aal === null ? 'missing' : 'failed',
    result: satisfied ? 'ok' : '2fa_required',
    request_id: ctx.requestId,
    actor_id: ctx.actorId,
    actor_type: ctx.actorType,
    ip: ctx.ip,
    route: ctx.route,
  });

  return satisfied;
};
