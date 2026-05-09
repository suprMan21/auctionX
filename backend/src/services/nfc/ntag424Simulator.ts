import { createCipheriv, randomBytes } from 'crypto';
import { computeCmac } from './ntag424';

export const generateAesKey = (): string => randomBytes(16).toString('hex').toUpperCase();

export const generateTagUid = (): string => randomBytes(7).toString('hex').toUpperCase();

export const encryptPiccData = (uidHex: string, counter: number, aesKeyHex: string): string => {
  if (!/^[0-9A-Fa-f]{14}$/.test(uidHex)) throw new Error('uidHex must be 14 hex chars (7 bytes)');
  if (!/^[0-9A-Fa-f]{32}$/.test(aesKeyHex)) throw new Error('aesKeyHex must be 32 hex chars (16 bytes)');
  if (counter < 0 || counter > 0xffffff) throw new Error('counter must fit in 3 bytes');

  // 0xC7 || UID(7B) || counter(3B little-endian) || pad(5B = 0x00) → 16 bytes
  const block = Buffer.alloc(16, 0);
  block[0] = 0xc7;
  Buffer.from(uidHex, 'hex').copy(block, 1);
  block[8] = counter & 0xff;
  block[9] = (counter >> 8) & 0xff;
  block[10] = (counter >> 16) & 0xff;

  const key = Buffer.from(aesKeyHex, 'hex');
  const iv = Buffer.alloc(16, 0);
  const cipher = createCipheriv('aes-128-cbc', key, iv);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(block), cipher.final()]);

  return encrypted.toString('hex').toUpperCase();
};

export const buildSunUrl = (
  baseUrl: string,
  tokenName: string,
  encPiccHex: string,
  cmacHex: string,
): string => {
  const trimmed = baseUrl.replace(/\/$/, '');
  const params = new URLSearchParams({ picc_data: encPiccHex, cmac: cmacHex });
  return `${trimmed}/verify/${encodeURIComponent(tokenName)}?${params.toString()}`;
};

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

export const simulateTap = (params: SimulateTapParams): SimulateTapResult => {
  const piccData = encryptPiccData(params.tagUid, params.counter, params.aesKeyHex);
  const cmacFull = computeCmac(piccData, params.aesKeyHex);
  const cmac = cmacFull.substring(0, 16).toUpperCase();
  const sunUrl = buildSunUrl(params.baseUrl, params.tokenName, piccData, cmac);
  return { sunUrl, piccData, cmac };
};
