import type { ValidateScanParams, ScanValidationResult } from './types';
import {
  parseSunMessage,
  decryptPiccData,
  computeCmac,
  truncateCmac,
  verifyCmac,
} from './ntag424Codec';

// Re-export the canonical codec primitives so existing verify-side consumers
// (nfcController, tests) keep their import surface. The crypto itself now lives
// in ntag424Codec.ts — the single source of truth shared with the encode side.
export { parseSunMessage, decryptPiccData, computeCmac, truncateCmac, verifyCmac };

/**
 * Full validation pipeline: parse URL → decrypt PICCData → verify CMAC → check counter.
 */
export const validateScan = (params: ValidateScanParams): ScanValidationResult => {
  const { tagUid, sunMessage, storedAesKey, lastCounter } = params;

  // Parse SUN message
  const parts = parseSunMessage(sunMessage);
  if (!parts) {
    return { valid: false, decryptedUid: null, counterValue: null, error: 'Invalid SUN message format' };
  }

  // Decrypt PICCData
  const decrypted = decryptPiccData(parts.encPiccData, storedAesKey);
  if (!decrypted) {
    return { valid: false, decryptedUid: null, counterValue: null, error: 'Failed to decrypt PICCData' };
  }

  // Verify UID matches
  if (decrypted.uid.toUpperCase() !== tagUid.toUpperCase()) {
    return { valid: false, decryptedUid: decrypted.uid, counterValue: decrypted.counter, error: 'UID mismatch' };
  }

  // Verify CMAC
  const cmacMessage = parts.encPiccData;
  if (!verifyCmac(cmacMessage, storedAesKey, parts.cmac)) {
    return { valid: false, decryptedUid: decrypted.uid, counterValue: decrypted.counter, error: 'CMAC verification failed' };
  }

  // Check counter is strictly increasing (replay protection)
  if (decrypted.counter <= lastCounter) {
    return { valid: false, decryptedUid: decrypted.uid, counterValue: decrypted.counter, error: 'Counter replay detected' };
  }

  return { valid: true, decryptedUid: decrypted.uid, counterValue: decrypted.counter };
};
