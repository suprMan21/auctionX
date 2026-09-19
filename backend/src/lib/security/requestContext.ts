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
 * Client IP from the trusted proxy header.
 *
 * App Runner terminates TLS and forwards the client address in
 * `x-forwarded-for`; the left-most entry is the original client. Falls back to
 * the socket address, and finally to a literal `unknown` so the envelope's
 * non-empty constraint always holds (a missing IP must not drop the event).
 */
const clientIp = (req: Request): string => {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = raw?.split(',')[0]?.trim();
  return first || req.socket?.remoteAddress || 'unknown';
};

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
