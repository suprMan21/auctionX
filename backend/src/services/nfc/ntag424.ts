/**
 * SDM scan validation pipeline — S-NFC3.5 (AN12196, AES mode).
 *
 *   parse URL -> derive META(version) -> decrypt PICCData -> UID + counter
 *   -> [UID (and serial) match the claimed tag?] -> derive FILE(version, UID[, serial])
 *   -> SDMMAC (constant-time) -> counter strictly increasing
 *
 * S-NFC-ID: a chip at version >= 2 carries its serial in the URL (`sn`). The
 * serial is part of its FILE key and of the MAC input, so a tap verifies only
 * under the serial the chip was encoded with. Version and serial presence must
 * agree: a v2 row never verifies a serial-less URL, a v1 row never a serial.
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
  v2MacInput,
  verifySdmMac,
  type PiccData,
} from './ntag424Codec';
import { SERIAL_KDF_VERSION } from './keys/keyDerivation';
import type { KeyAuditContext, TagKeyProvider } from './keys/tagKeyProvider';

export { parseSunMessage };

/**
 * v1 NDEF layout: SDMMACInputOffset == SDMMACOffset (no SDMENCFileData), so
 * the MAC input range is empty. v2 uses `v2MacInput`. See tag-encoder
 * `build_sdm_template`.
 */
export const SDM_URL_MAC_INPUT = Buffer.alloc(0);

/** True when the URL shape (serial present or not) matches the chip's KDF version. */
export const serialMatchesVersion = (version: number, serial: string | undefined): boolean =>
  (version >= SERIAL_KDF_VERSION) === (serial !== undefined);

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
  readonly encPiccHex: string;
  readonly cmacHex: string;
  readonly version: number;
  /** The `sn` from the URL. Required iff version >= 2. */
  readonly serial?: string;
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
  if (!serialMatchesVersion(p.version, p.serial)) {
    return { valid: false, ...base, error: 'invalid_signature' };
  }

  const serial = p.serial === undefined ? undefined : Buffer.from(p.serial, 'hex');
  const macInput = p.serial === undefined ? SDM_URL_MAC_INPUT : v2MacInput(p.serial, p.encPiccHex);
  const fileKey = await p.provider.deriveKey(
    { role: 'FILE', version: p.version, uid: picc.uid, serial },
    p.audit,
  );
  let macOk: boolean;
  try {
    macOk = verifySdmMac(fileKey, picc.uid, picc.counterLE, macInput, Buffer.from(p.cmacHex, 'hex'));
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
  /** The named tag's chip_serial (null on v1 rows). The URL's `sn` must equal it. */
  readonly expectedSerial?: string | null;
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
  // A URL from another chip that shares this UID: same PICCData UID, other serial.
  if (p.expectedSerial !== undefined && (p.expectedSerial ?? undefined) !== p.parts.serial) {
    return { valid: false, decryptedUid: picc.uidHex, counterValue: picc.counter, error: 'uid_mismatch' };
  }
  return verifyRecoveredScan({
    picc,
    encPiccHex: p.parts.encPiccData,
    cmacHex: p.parts.cmac,
    serial: p.parts.serial,
    version: p.version,
    lastCounter: p.lastCounter,
    expectedUid: p.expectedUid,
    provider: p.provider,
    audit: p.audit,
  });
};
