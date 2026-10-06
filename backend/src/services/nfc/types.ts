export interface SunMessageParts {
  encPiccData: string;
  cmac: string;
  /** S-NFC-ID v2 chips: the `sn` URL parameter, 16 uppercase hex. Absent on v1 chips. */
  serial?: string;
}

/**
 * Why an SDM scan failed. Closed set — never free text (it feeds security
 * events read by AI triage agents).
 *   malformed          URL/hex shape wrong
 *   invalid_signature  PICCData did not decode under the META key, or the
 *                      SDMMAC did not verify under the per-UID session key
 *   uid_mismatch       authentic PICCData for a DIFFERENT chip than the one
 *                      named by the request (Tag-A URL presented as Tag-B)
 *   replay_detected    authentic, but SDMReadCtr <= the last accepted counter
 */
export type SdmFailure = 'malformed' | 'invalid_signature' | 'uid_mismatch' | 'replay_detected';

export interface ScanValidationResult {
  valid: boolean;
  decryptedUid: string | null;
  counterValue: number | null;
  error?: SdmFailure;
}
