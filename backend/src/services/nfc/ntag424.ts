/**
 * SDM scan validation pipeline — S-NFC3.5 (AN12196, AES mode).
 *
 *   parse URL -> derive META(version) -> decrypt PICCData -> UID + counter
 *   -> [UID matches the claimed tag?] -> derive FILE(version, UID)
 *   -> SDMMAC (constant-time) -> counter strictly increasing
 *
 * MAC is checked BEFORE the counter, so a forged MAC on any counter reads as
 * `invalid_signature`, and only an authentic tap can be `replay_detected`.
 *
 * Keys are derived per call and wiped after use. Nothing here caches, logs or
 * returns key material.
 */

import type { ScanValidationResult, SunMessageParts } from './types';
import {
  decryptPiccData,
  isWellFormedSun,
  parseSunMessage,
  verifySdmMac,
  type PiccData,
} from './ntag424Codec';
import type { KeyAuditContext, TagKeyProvider } from './keys/tagKeyProvider';

export { parseSunMessage };

/**
 * Our NDEF layout has SDMMACInputOffset == SDMMACOffset (no SDMENCFileData),
 * so the MAC input range is empty. See tag-encoder `sdm_offsets_for_url`.
 */
export const SDM_URL_MAC_INPUT = Buffer.alloc(0);

/** Decrypts ENCPICCData under the fleet META key of `version`. Null if it doesn't decode. */
export const recoverPiccData = async (
  encPiccHex: string,
  version: number,
  provider: TagKeyProvider,
  audit: KeyAuditContext,
): Promise<PiccData | null> => {
  const metaKey = await provider.deriveKey({ role: 'META', version }, audit);
  try {
    return decryptPiccData(Buffer.from(encPiccHex, 'hex'), metaKey);
  } finally {
    metaKey.fill(0);
  }
};

export interface VerifyRecoveredParams {
  readonly picc: PiccData;
  readonly cmacHex: string;
  readonly version: number;
  readonly lastCounter: number;
  /** The chip the caller claims to hold. Omitted only when the UID itself identified the row. */
  readonly expectedUid?: string;
  readonly provider: TagKeyProvider;
  readonly audit: KeyAuditContext;
}

export const verifyRecoveredScan = async (p: VerifyRecoveredParams): Promise<ScanValidationResult> => {
  const { picc } = p;
  const base = { decryptedUid: picc.uidHex, counterValue: picc.counter };

  if (p.expectedUid !== undefined && p.expectedUid.toUpperCase() !== picc.uidHex) {
    return { valid: false, ...base, error: 'uid_mismatch' };
  }

  const fileKey = await p.provider.deriveKey(
    { role: 'FILE', version: p.version, uid: picc.uid },
    p.audit,
  );
  let macOk: boolean;
  try {
    macOk = verifySdmMac(fileKey, picc.uid, picc.counterLE, SDM_URL_MAC_INPUT, Buffer.from(p.cmacHex, 'hex'));
  } finally {
    fileKey.fill(0);
  }
  if (!macOk) return { valid: false, ...base, error: 'invalid_signature' };

  if (picc.counter <= p.lastCounter) {
    return { valid: false, ...base, error: 'replay_detected' };
  }

  return { valid: true, ...base };
};

export interface ValidateSunParams {
  readonly parts: SunMessageParts | null;
  readonly version: number;
  readonly lastCounter: number;
  readonly expectedUid?: string;
  readonly provider: TagKeyProvider;
  readonly audit: KeyAuditContext;
}

/** Full pipeline for a request that already names its tag (claim, transfer complete). */
export const validateSunScan = async (p: ValidateSunParams): Promise<ScanValidationResult> => {
  if (!p.parts || !isWellFormedSun(p.parts)) {
    return { valid: false, decryptedUid: null, counterValue: null, error: 'malformed' };
  }
  const picc = await recoverPiccData(p.parts.encPiccData, p.version, p.provider, p.audit);
  if (!picc) {
    return { valid: false, decryptedUid: null, counterValue: null, error: 'invalid_signature' };
  }
  return verifyRecoveredScan({
    picc,
    cmacHex: p.parts.cmac,
    version: p.version,
    lastCounter: p.lastCounter,
    expectedUid: p.expectedUid,
    provider: p.provider,
    audit: p.audit,
  });
};
