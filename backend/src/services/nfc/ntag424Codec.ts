import { createCipheriv, createDecipheriv } from 'crypto';
import type { SunMessageParts } from './types';

/**
 * Canonical NTAG 424 DNA codec — single source of truth for both the
 * encode side (simulator / Python encoder parity) and the verify side
 * (scan validation). Do not fork this logic; both lanes must produce
 * byte-identical output.
 *
 * Wire format (frozen):
 *   - PICC plaintext: 0xC7 || UID(7B) || counter(3B little-endian) || 0x00 * 5  → 16 bytes
 *   - Encryption: AES-128-CBC, zero IV, no padding
 *   - CMAC: AES-128-CMAC (RFC 4493) over the *encrypted* PICC data, truncated to first 8 bytes
 *   - SUN URL: {baseUrl}/verify/{tokenName}?picc_data=<hex>&cmac=<hex>, uppercase hex
 */

const BLOCK_SIZE = 16;
const PICC_HEADER = 0xc7;
const ZERO_IV = (): Buffer => Buffer.alloc(BLOCK_SIZE, 0);

/**
 * Build the 16-byte PICCData plaintext block from a UID and counter.
 * 0xC7 || UID(7B) || counter(3B little-endian) || pad(5B = 0x00).
 */
export const buildPiccPlaintext = (uidHex: string, counter: number): Buffer => {
  if (!/^[0-9A-Fa-f]{14}$/.test(uidHex)) throw new Error('uidHex must be 14 hex chars (7 bytes)');
  if (counter < 0 || counter > 0xffffff) throw new Error('counter must fit in 3 bytes');

  const block = Buffer.alloc(BLOCK_SIZE, 0);
  block[0] = PICC_HEADER;
  Buffer.from(uidHex, 'hex').copy(block, 1);
  block[8] = counter & 0xff;
  block[9] = (counter >> 8) & 0xff;
  block[10] = (counter >> 16) & 0xff;
  return block;
};

/**
 * Encrypt PICCData (AES-128-CBC, zero IV, no padding).
 * Returns uppercase hex of the 16-byte ciphertext.
 */
export const encryptPiccData = (uidHex: string, counter: number, aesKeyHex: string): string => {
  if (!/^[0-9A-Fa-f]{32}$/.test(aesKeyHex)) throw new Error('aesKeyHex must be 32 hex chars (16 bytes)');

  const block = buildPiccPlaintext(uidHex, counter);
  const key = Buffer.from(aesKeyHex, 'hex');
  const cipher = createCipheriv('aes-128-cbc', key, ZERO_IV());
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(block), cipher.final()]);
  return encrypted.toString('hex').toUpperCase();
};

/**
 * Decrypt the encrypted PICCData to recover the tag UID and read counter.
 * AES-128-CBC, zero IV, no padding. Returns null on header mismatch / error.
 */
export const decryptPiccData = (
  encPiccDataHex: string,
  aesKeyHex: string,
): { uid: string; counter: number } | null => {
  try {
    const key = Buffer.from(aesKeyHex, 'hex');
    const data = Buffer.from(encPiccDataHex, 'hex');

    const decipher = createDecipheriv('aes-128-cbc', key, ZERO_IV());
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);

    if (decrypted[0] !== PICC_HEADER) return null;

    const uid = decrypted.subarray(1, 8).toString('hex').toUpperCase();
    const counter = decrypted[8] | (decrypted[9] << 8) | (decrypted[10] << 16);

    return { uid, counter };
  } catch {
    return null;
  }
};

/**
 * Compute the full 16-byte AES-128-CMAC (RFC 4493) over a hex message.
 * Returns uppercase hex (32 chars).
 */
export const computeCmac = (messageHex: string, keyHex: string): string => {
  const key = Buffer.from(keyHex, 'hex');
  const message = Buffer.from(messageHex, 'hex');

  // Step 1: Generate subkeys
  const zeroBlock = Buffer.alloc(BLOCK_SIZE, 0);
  const cipher0 = createCipheriv('aes-128-ecb', key, null);
  cipher0.setAutoPadding(false);
  const L = cipher0.update(zeroBlock);

  const K1 = deriveSubkey(L);
  const K2 = deriveSubkey(K1);

  // Step 2: Pad and XOR
  const numBlocks = Math.max(1, Math.ceil(message.length / BLOCK_SIZE));
  const lastBlockIndex = numBlocks - 1;
  const isComplete = message.length > 0 && message.length % BLOCK_SIZE === 0;

  const blocks: Buffer[] = [];
  for (let i = 0; i < numBlocks; i++) {
    blocks.push(message.subarray(i * BLOCK_SIZE, (i + 1) * BLOCK_SIZE));
  }

  // XOR last block with K1 (complete) or K2 (padded)
  let lastBlock: Buffer;
  if (isComplete) {
    lastBlock = xorBuffers(blocks[lastBlockIndex], K1);
  } else {
    const padded = Buffer.alloc(BLOCK_SIZE, 0);
    const partial = blocks[lastBlockIndex];
    partial.copy(padded);
    padded[partial.length] = 0x80;
    lastBlock = xorBuffers(padded, K2);
  }
  blocks[lastBlockIndex] = lastBlock;

  // Step 3: CBC-MAC
  let x = Buffer.alloc(BLOCK_SIZE, 0);
  for (const block of blocks) {
    const xored = xorBuffers(x, block);
    const cipherN = createCipheriv('aes-128-ecb', key, null);
    cipherN.setAutoPadding(false);
    x = cipherN.update(xored);
  }

  return x.toString('hex').toUpperCase();
};

/**
 * Truncate a full CMAC (hex) to the first 8 bytes (16 hex chars), as the
 * NTAG 424 DNA chip does on the wire. Returns uppercase hex.
 */
export const truncateCmac = (fullCmacHex: string): string =>
  fullCmacHex.substring(0, 16).toUpperCase();

/**
 * Verify a truncated CMAC from a SUN scan against the expected value.
 */
export const verifyCmac = (messageHex: string, keyHex: string, expectedCmacHex: string): boolean => {
  const truncated = truncateCmac(computeCmac(messageHex, keyHex));
  return truncated === expectedCmacHex.toUpperCase();
};

/**
 * Parse SUN (Secure Unique NFC) message URL parameters.
 * NTAG 424 DNA appends ?picc_data=<hex>&cmac=<hex> to the mirror URL.
 */
export const parseSunMessage = (url: string): SunMessageParts | null => {
  try {
    const parsed = new URL(url);
    const encPiccData = parsed.searchParams.get('picc_data') ?? parsed.searchParams.get('e');
    const cmac = parsed.searchParams.get('cmac') ?? parsed.searchParams.get('c');

    if (!encPiccData || !cmac) return null;
    return { encPiccData, cmac };
  } catch {
    return null;
  }
};

/**
 * Build the SUN verification URL: {baseUrl}/verify/{tokenName}?picc_data=..&cmac=..
 */
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

// --- RFC 4493 helpers ---

const deriveSubkey = (input: Buffer): Buffer => {
  const shifted = Buffer.alloc(input.length);
  let carry = 0;
  for (let i = input.length - 1; i >= 0; i--) {
    shifted[i] = ((input[i] << 1) | carry) & 0xff;
    carry = input[i] & 0x80 ? 1 : 0;
  }
  if (input[0] & 0x80) {
    shifted[input.length - 1] ^= 0x87; // Rb for 128-bit block
  }
  return shifted;
};

const xorBuffers = (a: Buffer, b: Buffer): Buffer => {
  const result = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] ^ b[i];
  }
  return result;
};
