import { randomBytes } from 'crypto';
import {
  buildPiccPlaintext,
  buildSunUrl,
  computeSdmMac,
  encryptPiccBlock,
} from './ntag424Codec';
import { SDM_URL_MAC_INPUT } from './ntag424';
import type { KeyAuditContext, TagKeyProvider } from './keys/tagKeyProvider';

export { buildSunUrl };

/** Random 7-byte UID with the NXP manufacturer byte (0x04) first. */
export const generateTagUid = (): string =>
  Buffer.concat([Buffer.from([0x04]), randomBytes(6)]).toString('hex').toUpperCase();

export interface SimulateTapParams {
  readonly tagUid: string;
  readonly counter: number;
  readonly version: number;
  readonly baseUrl: string;
  readonly tokenName: string;
  readonly provider: TagKeyProvider;
  readonly audit: KeyAuditContext;
  /** 5 PICCData padding bytes; random (as on silicon) when omitted. */
  readonly padding?: Buffer;
}

export interface SimulateTapResult {
  readonly sunUrl: string;
  readonly piccData: string;
  readonly cmac: string;
}

/**
 * Simulates what a personalised NTAG 424 DNA mirrors into its URL on a tap,
 * using AN12196 SDM with keys from the provider (never stored keys). Output
 * validates through `validateSunScan`.
 */
export const simulateTap = async (p: SimulateTapParams): Promise<SimulateTapResult> => {
  const uid = Buffer.from(p.tagUid, 'hex');
  const plaintext = buildPiccPlaintext(uid, p.counter, p.padding);
  const counterLE = plaintext.subarray(8, 11);

  const metaKey = await p.provider.deriveKey({ role: 'META', version: p.version }, p.audit);
  let enc: Buffer;
  try {
    enc = encryptPiccBlock(plaintext, metaKey);
  } finally {
    metaKey.fill(0);
  }

  const fileKey = await p.provider.deriveKey({ role: 'FILE', version: p.version, uid }, p.audit);
  let mac: Buffer;
  try {
    mac = computeSdmMac(fileKey, uid, counterLE, SDM_URL_MAC_INPUT);
  } finally {
    fileKey.fill(0);
  }

  const piccData = enc.toString('hex').toUpperCase();
  const cmac = mac.toString('hex').toUpperCase();
  return { sunUrl: buildSunUrl(p.baseUrl, p.tokenName, piccData, cmac), piccData, cmac };
};
