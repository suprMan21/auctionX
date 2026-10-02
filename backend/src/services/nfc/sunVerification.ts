/**
 * Fresh-SUN verification shared by origin claim and transfer completion.
 *
 * Rule 2 of S-NFC3: "Transfer completion requires a fresh SUN scan by the
 * recipient; the read counter must exceed the last recorded value."
 *
 * The counter lives in `nfc_tags.sun_counter` — the single source of truth
 * (Locked decision: no `last_counter`). This function only *checks* it; the
 * caller burns it with a conditional update
 * (`.lt('sun_counter', n)`), so two racing requests with the same tap cannot
 * both succeed — the loser is `replay_detected`.
 *
 * Emits `nfc.sun_verify` on EVERY outcome, including rejections: replays and
 * forged MACs are the detections S-SEC0 is being fed.
 *
 * Crypto: real NXP AN12196 SDM (S-NFC3.5) — see ntag424.ts / ntag424Codec.ts.
 */

import { parseSunMessage, validateSunScan } from './ntag424';
import { getTagKeyProvider } from './keys/config';
import type { SdmFailure } from './types';
import { emitSecurityEvent, type SecurityResult } from '../../lib/security/securityEvent';
import type { SecurityLogContext } from '../../lib/ownership/ownershipProof';

export type SunContext = 'verify' | 'claim' | 'transfer_complete';

export type SunResult =
  | 'ok'
  | 'invalid_signature'
  | 'replay_detected'
  | 'uid_mismatch'
  | 'unknown_tag'
  | 'malformed';

export interface SunCheckInput {
  readonly tagId: string | null;
  /** The chip UID the caller says they are holding (row's tag_uid). */
  readonly tagUid: string;
  readonly sunMessage: string;
  /** nfc_tags.sdm_key_version (null on legacy rows = 1). */
  readonly keyVersion: number | null;
  readonly lastCounter: number;
}

export interface SunCheckOutcome {
  readonly ok: boolean;
  readonly sunResult: SunResult;
  readonly counter: number | null;
}

/**
 * Maps a validation failure onto the closed `sun_result` enum. Explicit rather
 * than a passthrough so nothing free-text can ever reach a log line.
 *
 * Counter regressions (counter < last) are NOT a separate code: any counter
 * <= last is `replay_detected`. S-SEC0 can still tell them apart, because the
 * event carries both `counter` and `last_counter`.
 */
export const classify = (error: SdmFailure | undefined): SunResult => {
  switch (error) {
    case undefined:
      return 'ok';
    case 'malformed':
      return 'malformed';
    case 'invalid_signature':
      return 'invalid_signature';
    case 'uid_mismatch':
      return 'uid_mismatch';
    case 'replay_detected':
      return 'replay_detected';
    default:
      return 'malformed';
  }
};

/**
 * API-facing error code for a failed SUN check. `replay_detected` and
 * `invalid_signature` are surfaced as such (acceptance criteria); a UID
 * mismatch is a signature failure from the caller's point of view.
 */
export const sunFailureCode = (sunResult: SunResult): SecurityResult => {
  switch (sunResult) {
    case 'replay_detected':
      return 'replay_detected';
    case 'invalid_signature':
    case 'uid_mismatch':
      return 'invalid_signature';
    default:
      return 'sun_invalid';
  }
};

export const emitSunVerify = (
  tagId: string | null,
  context: SunContext,
  sunResult: SunResult,
  counter: number | null,
  lastCounter: number | null,
  result: SecurityResult,
  ctx: SecurityLogContext,
): void => {
  emitSecurityEvent({
    event: 'nfc.sun_verify',
    tag_id: tagId,
    context,
    sun_result: sunResult,
    counter,
    last_counter: lastCounter,
    result,
    request_id: ctx.requestId,
    actor_id: ctx.actorId,
    actor_type: ctx.actorType,
    ip: ctx.ip,
    route: ctx.route,
  });
};

export const verifyFreshSun = async (
  input: SunCheckInput,
  context: SunContext,
  result: SecurityResult,
  ctx: SecurityLogContext,
): Promise<SunCheckOutcome> => {
  const validation = await validateSunScan({
    parts: parseSunMessage(input.sunMessage),
    version: input.keyVersion ?? 1,
    lastCounter: input.lastCounter,
    expectedUid: input.tagUid,
    provider: getTagKeyProvider(),
    audit: { ctx, tagId: input.tagId },
  });

  const sunResult = classify(validation.error);

  emitSunVerify(
    input.tagId,
    context,
    sunResult,
    validation.counterValue,
    input.lastCounter,
    validation.valid ? result : sunFailureCode(sunResult),
    ctx,
  );

  return { ok: validation.valid, sunResult, counter: validation.counterValue };
};

/** Emits an `nfc.sun_verify` for a tag that could not be looked up at all. */
export const emitUnknownTagSun = (context: SunContext, ctx: SecurityLogContext): void => {
  emitSunVerify(null, context, 'unknown_tag', null, null, 'not_found', ctx);
};

/**
 * A conditional counter burn matched no row: another request consumed this
 * (or a later) counter between our read and our write. That IS a replay.
 */
export const emitRaceReplay = (
  tagId: string,
  context: SunContext,
  counter: number,
  lastCounter: number,
  ctx: SecurityLogContext,
): void => {
  emitSunVerify(tagId, context, 'replay_detected', counter, lastCounter, 'replay_detected', ctx);
};
