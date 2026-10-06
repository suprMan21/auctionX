/**
 * Resolve + verify + burn a public SUN tap — shared by POST /nfc/scan and
 * POST /nfc/tap (S-NFC3-FE).
 *
 * Identification:
 *   v2 (S-NFC-ID, URL carries `sn`): the serial selects the row, the row's
 *       sdm_key_version selects the META key — one decrypt, then the decrypted
 *       UID must equal the row's tag_uid. The UID alone never selects a v2 row:
 *       chips can share a UID.
 *   v1 (no `sn`): ONE META decrypt per live key version (current first);
 *       PICCData yields the UID, the UID selects the v1 row (chip_serial null).
 * No trial decryption across stored per-tag keys (the S-NFC2 path did up to 500).
 *
 * The counter burn is the conditional `lt('sun_counter', n)` update: zero rows
 * means another request already consumed this (or a later) counter -> replay.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../lib/errors';
import { withLogContext } from '../../lib/logger';
import type { SecurityLogContext } from '../../lib/ownership/ownershipProof';
import { recoverPiccData, verifyRecoveredScan } from './ntag424';
import type { PiccData } from './ntag424Codec';
import type { ScanValidationResult, SunMessageParts } from './types';
import { currentSdmKeyVersion, getTagKeyProvider } from './keys/config';
import { SERIAL_KDF_VERSION } from './keys/keyDerivation';
import { classify, emitSunVerify, sunFailureCode, type SunResult } from './sunVerification';

export type ResolvedTagRow = {
  id: string;
  tag_uid: string;
  chip_serial: string | null;
  sun_counter: number;
  sdm_key_version: number | null;
  verification_id: string | null;
  status: string;
  lifecycle_status: string | null;
  current_owner_id: string | null;
};

const RESOLVE_COLUMNS =
  'id, tag_uid, chip_serial, sun_counter, sdm_key_version, verification_id, status, lifecycle_status, current_owner_id';

export interface ResolvedTap {
  readonly tag: ResolvedTagRow;
  readonly result: ScanValidationResult;
  readonly sunResult: SunResult;
}

/**
 * @throws AppError('not_found') when no enrolled chip matches the tap.
 */
export const resolveAndBurnSun = async (
  supabase: SupabaseClient,
  params: { readonly parts: SunMessageParts; readonly claimedUid?: string },
  ctx: SecurityLogContext,
): Promise<ResolvedTap> => {
  const logger = withLogContext({ requestId: ctx.requestId, route: ctx.route });
  const provider = getTagKeyProvider();

  let match: { tag: ResolvedTagRow; picc: PiccData; version: number } | null = null;
  let decoded = false;

  const lookupFailed = (error: { message: string }): never => {
    logger.error('nfc_scan_lookup_failed', { error: error.message });
    throw new AppError('internal', 'Tag lookup failed');
  };

  if (params.parts.serial !== undefined) {
    const { data: row, error: rowError } = await supabase
      .from('nfc_tags')
      .select(RESOLVE_COLUMNS)
      .eq('chip_serial', params.parts.serial)
      .maybeSingle();
    if (rowError) lookupFailed(rowError);
    const tagRow = row as ResolvedTagRow | null;
    const version = tagRow?.sdm_key_version ?? 1;
    if (tagRow && version >= SERIAL_KDF_VERSION) {
      const picc = await recoverPiccData(params.parts.encPiccData, version, provider, { ctx, tagId: tagRow.id });
      decoded = picc !== null;
      if (picc && picc.uidHex === tagRow.tag_uid.toUpperCase()) {
        match = { tag: tagRow, picc, version };
      }
    }
  }

  // v1 chips only (no serial). v1 keys take no serial, so only v1 versions are tried.
  const v1Top = params.parts.serial === undefined ? Math.min(currentSdmKeyVersion(), SERIAL_KDF_VERSION - 1) : 0;
  for (let version = v1Top; version >= 1 && !match; version--) {
    const picc = await recoverPiccData(params.parts.encPiccData, version, provider, { ctx });
    if (!picc) continue;
    decoded = true;

    // v1 rows only: a v2 chip sharing this UID is never selected without its serial.
    const { data: row, error: rowError } = await supabase
      .from('nfc_tags')
      .select(RESOLVE_COLUMNS)
      .eq('tag_uid', picc.uidHex)
      .is('chip_serial', null)
      .maybeSingle();
    if (rowError) lookupFailed(rowError);
    const tagRow = row as ResolvedTagRow | null;
    // The chip must have been encoded under the version that decoded it.
    if (tagRow && (tagRow.sdm_key_version ?? 1) === version) {
      match = { tag: tagRow, picc, version };
    }
  }

  if (!match) {
    emitSunVerify(null, 'verify', decoded ? 'unknown_tag' : 'invalid_signature', null, null, 'not_found', ctx);
    logger.warn('nfc_scan_no_match', { decoded });
    throw new AppError('not_found', 'No NFC tag matched the scan');
  }

  const { tag, picc, version } = match;

  let result: ScanValidationResult = await verifyRecoveredScan({
    picc,
    encPiccHex: params.parts.encPiccData,
    cmacHex: params.parts.cmac,
    serial: params.parts.serial,
    version,
    lastCounter: tag.sun_counter,
    expectedUid: params.claimedUid,
    provider,
    audit: { ctx, tagId: tag.id },
  });

  if (result.valid && result.counterValue !== null) {
    const { data: burned, error: burnError } = await supabase
      .from('nfc_tags')
      .update({
        sun_counter: result.counterValue,
        status: 'active',
        activated_at: tag.status === 'registered' ? new Date().toISOString() : undefined,
      })
      .eq('id', tag.id)
      .lt('sun_counter', result.counterValue)
      .select('id');
    if (burnError) {
      // A database failure is not evidence of a replay — don't report it as one.
      logger.error('nfc_scan_counter_burn_failed', { tagId: tag.id, error: burnError.message });
      throw new AppError('internal', 'Failed to record scan');
    }
    if (!burned || burned.length === 0) {
      result = { ...result, valid: false, error: 'replay_detected' };
    }
  }

  const sunResult = classify(result.error);
  emitSunVerify(
    tag.id,
    'verify',
    sunResult,
    result.counterValue,
    tag.sun_counter,
    result.valid ? 'ok' : sunFailureCode(sunResult),
    ctx,
  );
  if (!result.valid) logger.warn('nfc_scan_failed', { tagId: tag.id, reason: sunResult });

  return { tag, result, sunResult };
};
