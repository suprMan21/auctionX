import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'crypto';
import type { SunMessageParts } from './types';

/**
 * NXP AN12196 Secure Dynamic Messaging (SDM / SUN), AES mode — chip-exact.
 * S-NFC3.5 replaced the S-NFC2 simplified CMAC with this; the simplified path
 * is deleted, not flagged off.
 *
 * Byte-identical counterpart: `tag-encoder/tag_encoder/ntag424/encode.py`.
 * Both are pinned by `test-vectors/ntag424_sdm_vectors.json` (OpenSSL oracle,
 * incl. AN12196's own all-zero-key example).
 *
 *   PICCData   = AES-128-CBC-decrypt(SDMMetaReadKey, IV = 0, ENCPICCData[16])
 *              = PICCDataTag(1) || UID(7) || SDMReadCtr(3, little-endian) || padding(5)
 *   PICCDataTag: bit7 UID mirrored, bit6 SDMReadCtr mirrored, bits3..0 UID length
 *   SV2        = 3C C3 00 01 00 80 || UID(7) || SDMReadCtr(3, LE as on the wire)
 *   KSesSDMFileReadMAC = AES-CMAC(SDMFileReadKey, SV2)
 *   SDMMAC     = AES-CMAC(KSesSDMFileReadMAC, file[SDMMACInputOffset : SDMMACOffset])
 *   on wire    = even-numbered bytes of SDMMAC (indices 1,3,...,15) -> 8 bytes
 *
 * Our URL layouts have no SDMENCFileData. v1: SDMMACInputOffset ==
 * SDMMACOffset, so the MAC input is the empty string. v2 (S-NFC-ID,
 * `?sn=<serial>&picc_data=…&cmac=…`): the range starts at the serial value, see
 * `v2MacInput`. `extractMacInput` implements the general range.
 */

const BLOCK = 16;
const UID_LEN = 7;
const ZERO_IV = (): Buffer => Buffer.alloc(BLOCK, 0);
export const SV2_PREFIX = Buffer.from('3CC300010080', 'hex');
export const SDM_MAC_LEN = 8;

// ── PICCData ────────────────────────────────────────────────────────────────

export interface PiccDataTag {
  readonly uidMirrored: boolean;
  readonly ctrMirrored: boolean;
  readonly uidLength: number;
}

export const parsePiccDataTag = (byte: number): PiccDataTag => ({
  uidMirrored: (byte & 0x80) !== 0,
  ctrMirrored: (byte & 0x40) !== 0,
  uidLength: byte & 0x0f,
});

/** Our layout needs UID (7 bytes) AND counter mirrored. Anything else is rejected. */
export const isAcceptablePiccDataTag = (tag: PiccDataTag): boolean =>
  tag.uidMirrored && tag.ctrMirrored && tag.uidLength === UID_LEN;

export interface PiccData {
  readonly uid: Buffer;
  readonly uidHex: string;
  /** SDMReadCtr exactly as on the wire (3 bytes, little-endian) — SV2 input. */
  readonly counterLE: Buffer;
  readonly counter: number;
}

/** Parses a decrypted 16-byte PICCData block. Returns null on any violation. */
export const parsePiccPlaintext = (plain: Buffer): PiccData | null => {
  if (plain.length !== BLOCK) return null;
  const tag = parsePiccDataTag(plain[0]);
  if (!isAcceptablePiccDataTag(tag)) return null;
  const uid = Buffer.from(plain.subarray(1, 1 + UID_LEN));
  const counterLE = Buffer.from(plain.subarray(1 + UID_LEN, 1 + UID_LEN + 3));
  return {
    uid,
    uidHex: uid.toString('hex').toUpperCase(),
    counterLE,
    counter: counterLE.readUIntLE(0, 3),
  };
};

const aesCbc = (encrypt: boolean, key: Buffer, data: Buffer): Buffer => {
  if (key.length !== BLOCK) throw new Error('AES-128 key must be 16 bytes');
  const c = encrypt
    ? createCipheriv('aes-128-cbc', key, ZERO_IV())
    : createDecipheriv('aes-128-cbc', key, ZERO_IV());
  c.setAutoPadding(false);
  return Buffer.concat([c.update(data), c.final()]);
};

/** AES-128-CBC-decrypt (IV 0) of the 16-byte ENCPICCData. */
export const decryptPiccBlock = (encPicc: Buffer, metaKey: Buffer): Buffer => {
  if (encPicc.length !== BLOCK) throw new Error('ENCPICCData must be 16 bytes');
  return aesCbc(false, metaKey, encPicc);
};

/** Decrypt + parse. Null when the block does not decode to an acceptable PICCData. */
export const decryptPiccData = (encPicc: Buffer, metaKey: Buffer): PiccData | null => {
  if (encPicc.length !== BLOCK) return null;
  return parsePiccPlaintext(decryptPiccBlock(encPicc, metaKey));
};

/** Encode side (simulator / encoder parity): PICCDataTag 0xC7 || UID || ctr LE || padding. */
export const buildPiccPlaintext = (uid: Buffer, counter: number, padding?: Buffer): Buffer => {
  if (uid.length !== UID_LEN) throw new Error('UID must be 7 bytes');
  if (!Number.isInteger(counter) || counter < 0 || counter > 0xffffff) {
    throw new Error('counter must fit in 3 bytes');
  }
  const pad = padding ?? randomBytes(5);
  if (pad.length !== 5) throw new Error('PICCData padding must be 5 bytes');
  const ctr = Buffer.alloc(3);
  ctr.writeUIntLE(counter, 0, 3);
  return Buffer.concat([Buffer.from([0xc7]), uid, ctr, pad]);
};

export const encryptPiccBlock = (plaintext: Buffer, metaKey: Buffer): Buffer => {
  if (plaintext.length !== BLOCK) throw new Error('PICCData must be 16 bytes');
  return aesCbc(true, metaKey, plaintext);
};

// ── AES-CMAC (RFC 4493) ─────────────────────────────────────────────────────

const ecbBlock = (key: Buffer, block: Buffer): Buffer => {
  const c = createCipheriv('aes-128-ecb', key, null);
  c.setAutoPadding(false);
  return c.update(block);
};

const deriveSubkey = (input: Buffer): Buffer => {
  const out = Buffer.alloc(BLOCK);
  let carry = 0;
  for (let i = BLOCK - 1; i >= 0; i--) {
    out[i] = ((input[i] << 1) | carry) & 0xff;
    carry = input[i] & 0x80 ? 1 : 0;
  }
  if (input[0] & 0x80) out[BLOCK - 1] ^= 0x87;
  return out;
};

const xor = (a: Buffer, b: Buffer): Buffer => {
  const out = Buffer.alloc(BLOCK);
  for (let i = 0; i < BLOCK; i++) out[i] = a[i] ^ b[i];
  return out;
};

/** Full 16-byte AES-128-CMAC. Empty input is a single padded block (RFC 4493 §2.4). */
export const aesCmac = (key: Buffer, message: Buffer): Buffer => {
  if (key.length !== BLOCK) throw new Error('AES-128 key must be 16 bytes');
  const k1 = deriveSubkey(ecbBlock(key, Buffer.alloc(BLOCK, 0)));
  const k2 = deriveSubkey(k1);

  const n = Math.max(1, Math.ceil(message.length / BLOCK));
  const complete = message.length > 0 && message.length % BLOCK === 0;

  let x: Buffer = Buffer.alloc(BLOCK, 0);
  for (let i = 0; i < n - 1; i++) {
    x = ecbBlock(key, xor(x, message.subarray(i * BLOCK, (i + 1) * BLOCK)));
  }
  const tail = message.subarray((n - 1) * BLOCK);
  let last: Buffer;
  if (complete) {
    last = xor(tail, k1);
  } else {
    const padded = Buffer.alloc(BLOCK, 0);
    tail.copy(padded);
    padded[tail.length] = 0x80;
    last = xor(padded, k2);
  }
  return ecbBlock(key, xor(x, last));
};

// ── SDM MAC ─────────────────────────────────────────────────────────────────

export const buildSv2 = (uid: Buffer, counterLE: Buffer): Buffer => {
  if (uid.length !== UID_LEN || counterLE.length !== 3) throw new Error('SV2 needs UID(7) + ctr(3)');
  return Buffer.concat([SV2_PREFIX, uid, counterLE]);
};

/** KSesSDMFileReadMAC = AES-CMAC(SDMFileReadKey, SV2). */
export const deriveSessionMacKey = (fileKey: Buffer, uid: Buffer, counterLE: Buffer): Buffer =>
  aesCmac(fileKey, buildSv2(uid, counterLE));

/** AN12196 truncation: the even-numbered bytes (1-based) = indices 1,3,...,15. */
export const truncateSdmMac = (full: Buffer): Buffer => {
  if (full.length !== BLOCK) throw new Error('full CMAC must be 16 bytes');
  const out = Buffer.alloc(SDM_MAC_LEN);
  for (let i = 0; i < SDM_MAC_LEN; i++) out[i] = full[2 * i + 1];
  return out;
};

/** MAC input = the mirrored file bytes from SDMMACInputOffset up to SDMMACOffset. */
export const extractMacInput = (
  fileData: Buffer,
  macInputOffset: number,
  sdmMacOffset: number,
): Buffer => {
  if (macInputOffset < 0 || sdmMacOffset < macInputOffset || sdmMacOffset > fileData.length) {
    throw new Error('SDM MAC input range out of bounds');
  }
  return Buffer.from(fileData.subarray(macInputOffset, sdmMacOffset));
};

/** Full 16-byte SDMMAC (before truncation). */
export const computeFullSdmMac = (
  fileKey: Buffer,
  uid: Buffer,
  counterLE: Buffer,
  macInput: Buffer,
): Buffer => {
  const ses = deriveSessionMacKey(fileKey, uid, counterLE);
  try {
    return aesCmac(ses, macInput);
  } finally {
    ses.fill(0);
  }
};

/** The 8 bytes the chip mirrors into the URL. */
export const computeSdmMac = (
  fileKey: Buffer,
  uid: Buffer,
  counterLE: Buffer,
  macInput: Buffer,
): Buffer => truncateSdmMac(computeFullSdmMac(fileKey, uid, counterLE, macInput));

/** Constant-time comparison of the presented 8-byte MAC against the expected one. */
export const verifySdmMac = (
  fileKey: Buffer,
  uid: Buffer,
  counterLE: Buffer,
  macInput: Buffer,
  presented: Buffer,
): boolean => {
  const expected = computeSdmMac(fileKey, uid, counterLE, macInput);
  // Length is public (fixed 8); checked first because timingSafeEqual throws on mismatch.
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(expected, presented);
};

// ── URL ─────────────────────────────────────────────────────────────────────

const HEX_PICC = /^[0-9A-Fa-f]{32}$/;
const HEX_MAC = /^[0-9A-Fa-f]{16}$/;
/** The encoder writes the serial in uppercase; the chip MACs exactly those bytes. */
export const CHIP_SERIAL_PATTERN = /^[0-9A-F]{16}$/;

/** Strict hex validation of the mirrored fields (and the serial, when present). */
export const isWellFormedSun = (parts: SunMessageParts): boolean =>
  HEX_PICC.test(parts.encPiccData) &&
  HEX_MAC.test(parts.cmac) &&
  (parts.serial === undefined || CHIP_SERIAL_PATTERN.test(parts.serial));

/**
 * v2 MAC input: the URL bytes the chip MACs, from the serial value up to the
 * cmac value — `<SERIAL>&picc_data=<ENCPICCData>&cmac=` in ASCII. The chip
 * mirrors ENCPICCData as uppercase hex, so it is normalised here.
 */
export const v2MacInput = (serial: string, encPiccHex: string): Buffer =>
  Buffer.from(`${serial}&picc_data=${encPiccHex.toUpperCase()}&cmac=`, 'ascii');

/**
 * Parse SUN URL parameters: `picc_data`/`e` (ENCPICCData), `cmac`/`c` (SDMMAC)
 * and, on v2 chips, `sn` (our chip serial). Returns null unless the required
 * pair is present and every present field is well-formed.
 */
export const parseSunMessage = (url: string): SunMessageParts | null => {
  try {
    const parsed = new URL(url);
    const encPiccData = parsed.searchParams.get('picc_data') ?? parsed.searchParams.get('e');
    const cmac = parsed.searchParams.get('cmac') ?? parsed.searchParams.get('c');
    const serial = parsed.searchParams.get('sn');
    if (!encPiccData || !cmac) return null;
    const parts: SunMessageParts = serial === null ? { encPiccData, cmac } : { encPiccData, cmac, serial };
    return isWellFormedSun(parts) ? parts : null;
  } catch {
    return null;
  }
};

/** `{baseUrl}/verify/{tokenName}?[sn=<hex>&]picc_data=<hex>&cmac=<hex>` (uppercase hex). */
export const buildSunUrl = (
  baseUrl: string,
  tokenName: string,
  encPiccHex: string,
  cmacHex: string,
  serial?: string,
): string => {
  const trimmed = baseUrl.replace(/\/$/, '');
  const params = new URLSearchParams(
    serial === undefined
      ? { picc_data: encPiccHex, cmac: cmacHex }
      : { sn: serial, picc_data: encPiccHex, cmac: cmacHex },
  );
  return `${trimmed}/verify/${encodeURIComponent(tokenName)}?${params.toString()}`;
};
