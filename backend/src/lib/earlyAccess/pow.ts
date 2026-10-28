import { createHash } from 'crypto';
import { POW_BITS, POW_MAX_AGE_MS, POW_PREFIX } from './constants';

/** Number of leading zero bits in a buffer. */
export const leadingZeroBits = (buf: Uint8Array): number => {
  let bits = 0;
  for (const byte of buf) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
};

export const powInput = (email: string, ts: number, nonce: string): string => `${POW_PREFIX}:${email}:${ts}:${nonce}`;

/**
 * Checks the browser's proof-of-work. It is bound to the (normalised) email, so one
 * solution cannot be reused for another address, and to a recent timestamp, so
 * solutions cannot be stockpiled. Replaying a solution for the same address is harmless:
 * a repeat signup does nothing.
 */
export const verifyPow = (
  email: string,
  pow: { ts: number; nonce: string },
  now: number = Date.now(),
  bits: number = POW_BITS,
): boolean => {
  if (!Number.isSafeInteger(pow.ts) || Math.abs(now - pow.ts) > POW_MAX_AGE_MS) return false;
  if (!/^[0-9a-z]{1,16}$/.test(pow.nonce)) return false;
  const digest = createHash('sha256').update(powInput(email, pow.ts, pow.nonce)).digest();
  return leadingZeroBits(digest) >= bits;
};
