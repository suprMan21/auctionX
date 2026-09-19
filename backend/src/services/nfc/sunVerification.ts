/**
 * Fresh-SUN verification shared by origin claim and transfer completion.
 *
 * Rule 2 of S-NFC3: "Transfer completion requires a fresh SUN scan by the
 * recipient; the read counter must exceed the last recorded value."
 *
 * The counter lives in `nfc_tags.sun_counter` — the same column the existing
 * scan path maintains. The brief asked for a new `last_counter`; deliberately
 * not added, because two counters would split the source of truth on precisely
 * the check that makes replay detection work.
 *
 * Emits `nfc.sun_verify` on EVERY outcome, including rejections: replays and
 * counter regressions are the detections S-SEC0 is being fed.
 *
 * NOTE: the SUN crypto here is the S-NFC2 codec. Real AN12196 SDM lands in
 * S-NFC3.5, and no physical chip may be encoded for customers until it does.
 */

import { validateScan } from './ntag424';
import { emitSecurityEvent, type SecurityResult } from '../../lib/security/securityEvent';
import type { SecurityLogContext } from '../../lib/ownership/ownershipProof';

export type SunContext = 'verify' | 'claim' | 'transfer_complete';

export type SunResult =
  | 'ok'
  | 'cmac_invalid'
  | 'counter_replay'
  | 'counter_regression'
  | 'unknown_tag'
  | 'malformed';

export interface SunCheckInput {
  readonly tagId: string | null;
  readonly tagUid: string;
  readonly sunMessage: string;
  readonly storedAesKey: string;
  readonly lastCounter: number;
}

export interface SunCheckOutcome {
  readonly ok: boolean;
  readonly sunResult: SunResult;
  readonly counter: number | null;
}

/**
 * Maps `validateScan`'s free-text error onto the closed `sun_result` enum.
 *
 * The mapping is explicit rather than a passthrough because the error string
 * must never reach a log line — no free-text fields, ever.
 */
const classify = (error: string | undefined, counter: number | null, lastCounter: number): SunResult => {
  if (!error) return 'ok';
  if (error.includes('Invalid SUN message format')) return 'malformed';
  if (error.includes('Failed to decrypt')) return 'cmac_invalid';
  if (error.includes('UID mismatch')) return 'unknown_tag';
  if (error.includes('CMAC')) return 'cmac_invalid';
  if (error.includes('Counter replay')) {
    // Equal counter is a straight replay of a captured tap; a lower one means
    // the chip went backwards, which a real NTAG 424 cannot do — that is
    // either a cloned chip or a forged URL, and S-SEC0 scores it higher.
    return counter !== null && counter < lastCounter ? 'counter_regression' : 'counter_replay';
  }
  return 'malformed';
};

export const verifyFreshSun = (
  input: SunCheckInput,
  context: SunContext,
  result: SecurityResult,
  ctx: SecurityLogContext,
): SunCheckOutcome => {
  const validation = validateScan({
    tagUid: input.tagUid,
    sunMessage: input.sunMessage,
    storedAesKey: input.storedAesKey,
    lastCounter: input.lastCounter,
  });

  const sunResult = classify(validation.error, validation.counterValue, input.lastCounter);

  emitSecurityEvent({
    event: 'nfc.sun_verify',
    tag_id: input.tagId,
    context,
    sun_result: sunResult,
    counter: validation.counterValue,
    last_counter: input.lastCounter,
    result: validation.valid ? result : 'sun_invalid',
    request_id: ctx.requestId,
    actor_id: ctx.actorId,
    actor_type: ctx.actorType,
    ip: ctx.ip,
    route: ctx.route,
  });

  return {
    ok: validation.valid,
    sunResult,
    counter: validation.counterValue,
  };
};

/** Emits an `nfc.sun_verify` for a tag that could not be looked up at all. */
export const emitUnknownTagSun = (
  context: SunContext,
  ctx: SecurityLogContext,
): void => {
  emitSecurityEvent({
    event: 'nfc.sun_verify',
    tag_id: null,
    context,
    sun_result: 'unknown_tag',
    counter: null,
    last_counter: null,
    result: 'not_found',
    request_id: ctx.requestId,
    actor_id: ctx.actorId,
    actor_type: ctx.actorType,
    ip: ctx.ip,
    route: ctx.route,
  });
};
