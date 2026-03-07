import { createCipheriv, createDecipheriv } from 'crypto';
import type { SunMessageParts, ValidateScanParams, ScanValidationResult } from './types';

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
 * Decrypt the encrypted PICCData to recover the tag UID and read counter.
 * NTAG 424 DNA uses AES-128-CBC with zero IV.
 * PICCData = 0xC7 || UID (7 bytes) || counter (3 bytes LE) || padding
 */
export const decryptPiccData = (encPiccDataHex: string, aesKeyHex: string): { uid: string; counter: number } | null => {
  try {
    const key = Buffer.from(aesKeyHex, 'hex');
    const data = Buffer.from(encPiccDataHex, 'hex');
    const iv = Buffer.alloc(16, 0);

    const decipher = createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);

    // Verify header byte 0xC7
    if (decrypted[0] !== 0xc7) return null;

    const uid = decrypted.subarray(1, 8).toString('hex').toUpperCase();
    // Counter is 3 bytes little-endian
    const counter = decrypted[8] | (decrypted[9] << 8) | (decrypted[10] << 16);

    return { uid, counter };
  } catch {
    return null;
  }
};

/**
 * Compute AES-128 CMAC (RFC 4493) over a message.
 * Used to verify the CMAC appended by the NTAG 424 DNA chip.
 */
export const computeCmac = (messageHex: string, keyHex: string): string => {
  const key = Buffer.from(keyHex, 'hex');
  const message = Buffer.from(messageHex, 'hex');

  // Step 1: Generate subkeys
  const zeroBlock = Buffer.alloc(16, 0);
  const cipher0 = createCipheriv('aes-128-ecb', key, null);
  cipher0.setAutoPadding(false);
  const L = cipher0.update(zeroBlock);

  const K1 = deriveSubkey(L);
  const K2 = deriveSubkey(K1);

  // Step 2: Pad and XOR
  const blockSize = 16;
  const numBlocks = Math.max(1, Math.ceil(message.length / blockSize));
  const lastBlockIndex = numBlocks - 1;
  const isComplete = message.length > 0 && message.length % blockSize === 0;

  const blocks: Buffer[] = [];
  for (let i = 0; i < numBlocks; i++) {
    blocks.push(message.subarray(i * blockSize, (i + 1) * blockSize));
  }

  // XOR last block with K1 (complete) or K2 (padded)
  let lastBlock: Buffer;
  if (isComplete) {
    lastBlock = xorBuffers(blocks[lastBlockIndex], K1);
  } else {
    const padded = Buffer.alloc(blockSize, 0);
    const partial = blocks[lastBlockIndex];
    partial.copy(padded);
    padded[partial.length] = 0x80;
    lastBlock = xorBuffers(padded, K2);
  }
  blocks[lastBlockIndex] = lastBlock;

  // Step 3: CBC-MAC
  let x = Buffer.alloc(blockSize, 0);
  for (const block of blocks) {
    const xored = xorBuffers(x, block);
    const cipherN = createCipheriv('aes-128-ecb', key, null);
    cipherN.setAutoPadding(false);
    x = cipherN.update(xored);
  }

  return x.toString('hex').toUpperCase();
};

/**
 * Verify CMAC from a SUN scan against the expected value.
 * The NTAG 424 DNA truncates CMAC to 8 bytes (first 16 hex chars).
 */
export const verifyCmac = (messageHex: string, keyHex: string, expectedCmacHex: string): boolean => {
  const computed = computeCmac(messageHex, keyHex);
  // NTAG 424 uses first 8 bytes of CMAC
  const truncated = computed.substring(0, 16);
  return truncated.toUpperCase() === expectedCmacHex.toUpperCase();
};

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

// --- Helpers ---

const deriveSubkey = (input: Buffer): Buffer => {
  const shifted = Buffer.alloc(input.length);
  let carry = 0;
  for (let i = input.length - 1; i >= 0; i--) {
    shifted[i] = ((input[i] << 1) | carry) & 0xff;
    carry = (input[i] & 0x80) ? 1 : 0;
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
