/**
 * Ownership ID resolution — S-NFC3.
 *
 * `GET /api/v1/ownership/:ownershipId` resolves to the token's PUBLIC verify
 * view (`public_tag_provenance`), plus "you own this" when the caller happens
 * to be the current owner.
 *
 * Privacy contract:
 *   - The lookup never reveals owner identity, to anybody, ever.
 *   - A stale ID reveals nothing beyond "no longer current" — not the tag, not
 *     the current ID, not whether the token still exists.
 *   - Old and new Ownership IDs are never linked in any public output.
 *   - The emitted `ownership.lookup` event carries NO owner or tag identity and
 *     not the Ownership ID itself; enumeration is detected by the volume of
 *     `not_found` results, which needs no identifiers.
 *
 * AN OWNERSHIP ID NEVER AUTHORIZES ANYTHING. This route is a read; it grants
 * nothing, and no other endpoint accepts an Ownership ID as proof of authority.
 */

import { Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { RequestWithId } from '../middleware/requestId';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../lib/errors';
import { emitSecurityEvent } from '../lib/security/securityEvent';
import { securityContext } from '../lib/security/requestContext';

interface OwnershipRequest extends RequestWithId, AuthRequest {}

const OWNERSHIP_ID_PATTERN = /^0x[0-9a-f]{64}$/;
const ROUTE = '/api/v1/ownership/:ownershipId';

export const resolveOwnershipId = async (req: OwnershipRequest, res: Response) => {
  const ctx = securityContext(req, ROUTE, req.user ? 'user' : 'anon');
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const ownershipId = String(req.params.ownershipId || '').toLowerCase();

  const emit = (lookupResult: 'current' | 'stale' | 'not_found') =>
    emitSecurityEvent({
      event: 'ownership.lookup',
      lookup_result: lookupResult,
      result: lookupResult === 'not_found' ? 'not_found' : 'ok',
      request_id: ctx.requestId,
      actor_id: ctx.actorId,
      actor_type: ctx.actorType,
      ip: ctx.ip,
      route: ctx.route,
    });

  // A malformed id is indistinguishable from an unknown one in the response:
  // telling an enumerator that their format was right is already information.
  if (!OWNERSHIP_ID_PATTERN.test(ownershipId)) {
    emit('not_found');
    throw new AppError('not_found', 'Ownership ID not found');
  }

  const { data: proof } = await supabase
    .from('ownership_proofs')
    .select('tag_id, owner_id, status')
    .eq('ownership_id', ownershipId)
    .maybeSingle();

  if (!proof) {
    emit('not_found');
    throw new AppError('not_found', 'Ownership ID not found');
  }

  if (proof.status === 'stale') {
    emit('stale');
    // Nothing else. Not the tag, not the current ID, not the owner.
    return res.status(200).json({
      success: true,
      data: { status: 'stale', message: 'This Ownership ID is no longer current' },
      error: null,
    });
  }

  const { data: provenance } = await supabase
    .from('public_tag_provenance')
    .select('*')
    .eq('tag_id', proof.tag_id)
    .maybeSingle();

  emit('current');

  return res.status(200).json({
    success: true,
    data: {
      status: 'current',
      // True only for the caller who is already the owner; it tells them
      // nothing they did not know, and tells everyone else nothing at all.
      youOwnThis: Boolean(req.user?.id && proof.owner_id === req.user.id),
      provenance: provenance ?? null,
    },
    error: null,
  });
};

/**
 * Detects an Ownership ID or Receipt being submitted on a route where
 * AUTHORITY is expected, and logs it as a probe signal.
 *
 * Such a request should never succeed — nothing in the API accepts these as
 * credentials — so every hit here is either a confused integrator or somebody
 * testing whether the identifier is secretly a bearer token. The request is not
 * blocked; it simply proceeds to fail its real auth check.
 */
export const ownershipAuthProbeDetector = (
  req: OwnershipRequest,
  _res: Response,
  next: () => void,
): void => {
  const body = req.body as Record<string, unknown> | undefined;

  if (body && typeof body === 'object') {
    const submitted =
      'ownershipId' in body || 'ownership_id' in body || 'receipt' in body;

    if (submitted) {
      const ctx = securityContext(req, req.baseUrl + (req.route?.path ?? ''), req.user ? 'user' : 'anon');
      emitSecurityEvent({
        event: 'ownership.auth_attempt',
        result: 'forbidden',
        request_id: ctx.requestId,
        actor_id: ctx.actorId,
        actor_type: ctx.actorType,
        ip: ctx.ip,
        route: ctx.route || 'unknown',
      });
    }
  }

  next();
};
