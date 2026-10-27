/**
 * One-time recovery codes: 10 per set, shown once, stored only as hashes.
 *
 * Format XXXXX-XXXXX from a 31-character alphabet without look-alikes
 * (no 0/O, 1/I/L), about 49 bits each. The hash is an HMAC under a server
 * pepper and bound to the user id, so a leaked table alone cannot be used to
 * test guesses, and one account's code never matches another's row.
 */

import { createHmac, randomInt } from 'crypto';
import { RECOVERY_CODE_COUNT, recoveryPepper } from './config';

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

const randomBlock = (len: number): string =>
  Array.from({ length: len }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

export const generateRecoveryCodes = (): string[] => {
  const codes = new Set<string>();
  while (codes.size < RECOVERY_CODE_COUNT) codes.add(`${randomBlock(5)}-${randomBlock(5)}`);
  return [...codes];
};

/**
 * Accepts what people actually type: any case, spaces, missing or extra dashes.
 * Returns null when it cannot be a code (wrong length or a character that is
 * never issued), so obvious junk never reaches the lockout counter as a "guess".
 */
export const normaliseRecoveryCode = (input: string): string | null => {
  const compact = input.toUpperCase().replace(/[\s-]/g, '');
  if (compact.length !== 10) return null;
  if ([...compact].some((c) => !ALPHABET.includes(c))) return null;
  return `${compact.slice(0, 5)}-${compact.slice(5)}`;
};

export const hashRecoveryCode = (userId: string, normalisedCode: string): string =>
  createHmac('sha256', recoveryPepper()).update(`${userId}:${normalisedCode}`).digest('hex');
