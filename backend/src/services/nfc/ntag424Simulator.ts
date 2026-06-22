import { randomBytes } from 'crypto';
import { encryptPiccData, computeCmac, truncateCmac, buildSunUrl } from './ntag424Codec';

// Re-export encode-side codec primitives so existing callers keep their import
// surface. The crypto lives in ntag424Codec.ts — the single source of truth.
export { encryptPiccData, buildSunUrl };

export const generateAesKey = (): string => randomBytes(16).toString('hex').toUpperCase();

export const generateTagUid = (): string => randomBytes(7).toString('hex').toUpperCase();

export interface SimulateTapParams {
  tagUid: string;
  counter: number;
  aesKeyHex: string;
  baseUrl: string;
  tokenName: string;
}

export interface SimulateTapResult {
  sunUrl: string;
  piccData: string;
  cmac: string;
}

/**
 * Simulate a physical NTAG 424 DNA tap: encrypt PICCData, compute the truncated
 * CMAC, and assemble the SUN verification URL. Output is byte-identical to what
 * a real chip emits and validates through validateScan().
 */
export const simulateTap = (params: SimulateTapParams): SimulateTapResult => {
  const piccData = encryptPiccData(params.tagUid, params.counter, params.aesKeyHex);
  const cmac = truncateCmac(computeCmac(piccData, params.aesKeyHex));
  const sunUrl = buildSunUrl(params.baseUrl, params.tokenName, piccData, cmac);
  return { sunUrl, piccData, cmac };
};
