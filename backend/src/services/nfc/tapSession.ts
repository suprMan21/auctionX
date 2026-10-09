/**
 * Tap sessions — S-NFC3-FE.
 *
 * A SUN tap can be verified exactly once (the counter burns). The public verify
 * page is where a tap lands, so it has to spend it. Claim and transfer
 * completion need proof of possession too, so `POST /nfc/tap` hands back a
 * tap session: a short-lived, single-use bearer token bound to the chip and to
 * the counter value that was burned.
 *
 * Invariants:
 *   1. Only SHA-256(token) is stored. The raw token exists in the response and
 *      the client, nowhere else (never logged).
 *   2. Single use, enforced by ONE conditional UPDATE: `consumed_at IS NULL AND
 *      expires_at > now`. Two racing redemptions cannot both get a row back.
 *   3. A session proves possession only as of its tap. The caller must check
 *      `counterValue` is still the chip's latest counter, so a newer tap by
 *      anyone supersedes every older session.
 *   4. Every failure collapses to one result (`tap_session_invalid`): which of
 *      unknown / expired / used / wrong chip / superseded is not disclosed.
 */

import { createHash, randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { emitSecurityEvent } from '../../lib/security/securityEvent';
import type { SecurityLogContext } from '../../lib/ownership/ownershipProof';

export const TAP_SESSION_TTL_MS = 10 * 60 * 1000;

/** 32 random bytes, base64url without padding: always 43 characters. */
export const TAP_SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type TapSessionPurpose = 'claim' | 'transfer_complete' | 'reissue_request';

export const hashTapSessionToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

export interface IssuedTapSession {
  readonly token: string;
  readonly expiresAt: string;
}

export const issueTapSession = async (
  supabase: SupabaseClient,
  params: { readonly tagId: string; readonly counterValue: number },
  ctx: SecurityLogContext,
  now: Date = new Date(),
): Promise<IssuedTapSession | null> => {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + TAP_SESSION_TTL_MS).toISOString();

  const { error } = await supabase.from('nfc_tap_sessions').insert({
    tag_id: params.tagId,
    token_hash: hashTapSessionToken(token),
    counter_value: params.counterValue,
    expires_at: expiresAt,
  });

  const result = error ? 'internal' : 'ok';
  emitSecurityEvent({
    event: 'nfc.tap_session', action: 'issue', tag_id: params.tagId, purpose: null, result,
    request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: ctx.actorType,
    ip: ctx.ip, route: ctx.route,
  });

  // A failed insert degrades to "verified, but tap again to act" rather than
  // failing the verification the visitor actually asked for.
  return error ? null : { token, expiresAt };
};

export interface RedeemedTapSession {
  readonly id: string;
  readonly tagId: string;
  readonly counterValue: number;
}

/**
 * Burns a tap session. Returns null for every kind of invalid session.
 *
 * The caller still has to check `counterValue` against the chip's current
 * counter (invariant 3) and the tag against the one it expects.
 */
export const consumeTapSession = async (
  supabase: SupabaseClient,
  params: { readonly token: string; readonly userId: string; readonly purpose: TapSessionPurpose },
  ctx: SecurityLogContext,
  now: Date = new Date(),
): Promise<RedeemedTapSession | null> => {
  let redeemed: RedeemedTapSession | null = null;

  if (TAP_SESSION_TOKEN_PATTERN.test(params.token)) {
    const { data, error } = await supabase
      .from('nfc_tap_sessions')
      .update({
        consumed_at: now.toISOString(),
        consumed_by: params.userId,
        consumed_for: params.purpose,
      })
      .eq('token_hash', hashTapSessionToken(params.token))
      .is('consumed_at', null)
      .gt('expires_at', now.toISOString())
      .select('id, tag_id, counter_value')
      .maybeSingle();

    if (!error && data) {
      redeemed = {
        id: data.id as string,
        tagId: data.tag_id as string,
        counterValue: data.counter_value as number,
      };
    }
  }

  emitSecurityEvent({
    event: 'nfc.tap_session', action: 'consume', tag_id: redeemed?.tagId ?? null,
    purpose: params.purpose, result: redeemed ? 'ok' : 'tap_session_invalid',
    request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: ctx.actorType,
    ip: ctx.ip, route: ctx.route,
  });

  return redeemed;
};
