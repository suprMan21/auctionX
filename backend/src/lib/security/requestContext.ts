/**
 * Builds the security-event envelope from an Express request — S-NFC3 Addendum.
 *
 * Exists so that `route` is always the Express route PATTERN and never the raw
 * URL. That distinction is a redaction rule, not a style preference: a raw URL
 * carries path parameters (and in some flows a query string), which would drag
 * ids and attacker-controlled strings into logs that AI triage agents read.
 */

import type { Request } from 'express';
import type { SecurityLogContext } from '../ownership/ownershipProof';

export type ActorType = SecurityLogContext['actorType'];

/**
 * Client IP as Express resolves it through the trusted App Runner proxies
 * (app.ts TRUSTED_PROXIES), i.e. the same address the rate limiters use.
 *
 * Never the left-most `x-forwarded-for` entry: the client writes that one, so
 * logging it lets anyone choose the IP in our security events. Falls back to
 * the socket address, and finally to a literal `unknown` so the envelope's
 * non-empty constraint always holds (a missing IP must not drop the event).
 */
const clientIp = (req: Request): string => req.ip || req.socket?.remoteAddress || 'unknown';

/**
 * @param routePattern The Express route pattern, passed explicitly by the
 *   caller. `req.route?.path` is only the path within the mounted router, so
 *   the full pattern cannot be reconstructed reliably inside a handler.
 */
export const securityContext = (
  req: Request & { requestId?: string; user?: { id: string } },
  routePattern: string,
  actorType: ActorType,
): SecurityLogContext => ({
  requestId: req.requestId || 'unknown',
  actorId: req.user?.id ?? null,
  actorType,
  ip: clientIp(req),
  route: routePattern,
});
