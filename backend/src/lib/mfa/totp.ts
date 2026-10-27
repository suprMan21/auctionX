/**
 * Authenticator-app codes (RFC 6238 TOTP: HMAC-SHA1, 6 digits, 30-second steps).
 *
 * Written here rather than pulled in: it is about 40 lines, and the RFC test
 * vectors in mfaTotp.test.ts pin it. SHA-1 is what every authenticator app
 * supports; it is used as an HMAC, where SHA-1's collision weakness does not apply.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const generateTotpSecret = (): Buffer => randomBytes(20);

export const base32Encode = (buf: Buffer): string => {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
};

/** HOTP (RFC 4226) for one counter value. */
export const hotp = (secret: Buffer, counter: number, digits = TOTP_DIGITS): string => {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return bin.toString().padStart(digits, '0');
};

export const totpStep = (nowMs: number): number => Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);

/**
 * Checks a code against the current step and one step either side (clock
 * drift). Returns the matching step, or null. The caller refuses any step at or
 * below the last one used, so a code cannot be replayed inside its window.
 */
export const matchTotp = (secret: Buffer, code: string, nowMs: number): number | null => {
  if (!/^\d{6}$/.test(code)) return null;
  const now = totpStep(nowMs);
  let matched: number | null = null;
  // Check all three without stopping early: equal time whichever step matches.
  for (const step of [now - 1, now, now + 1]) {
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code)) && matched === null) matched = step;
  }
  return matched;
};

/** The otpauth:// URI an authenticator app reads from a QR code. */
export const otpauthUri = (secret: Buffer, accountLabel: string, issuer: string): string => {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
};
