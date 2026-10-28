/**
 * S-2FA Ph3b emailed codes (S-2FAb AC13).
 *
 * 6 digits from a CSPRNG. Stored only as an HMAC whose key is derived from
 * MFA_RECOVERY_PEPPER under its own label, over purpose | code id | user |
 * session | code: a code is useless for another purpose, request, account or
 * session, and a database read alone cannot test guesses. The nonce the
 * browser sends (X-Recovery-Nonce) is stored as a plain sha256 and compared in
 * the database. Neither the code nor the nonce is ever logged.
 */

import { createHash, createHmac, hkdfSync, randomInt } from 'crypto';
import { recoveryPepper } from './config';

export type EmailCodePurpose = 'recovery_start' | 'recovery_finish' | 'backup_email_verify';
export type EmailChannel = 'primary' | 'backup';

export const generateEmailCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** Digits only, spaces and dashes ignored; null when it cannot be a code. */
export const normaliseEmailCode = (input: string): string | null => {
  const compact = input.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(compact) ? compact : null;
};

let cachedKey: { pepper: string; key: Buffer } | null = null;

const codeKey = (): Buffer => {
  const pepper = recoveryPepper();
  if (cachedKey?.pepper !== pepper) {
    cachedKey = { pepper, key: Buffer.from(hkdfSync('sha256', pepper, Buffer.alloc(0), 'am/email-code-v1', 32)) };
  }
  return cachedKey.key;
};

export const hashEmailCode = (p: {
  purpose: EmailCodePurpose; id: string; userId: string; sessionId: string; code: string;
}): string =>
  createHmac('sha256', codeKey()).update([p.purpose, p.id, p.userId, p.sessionId, p.code].join('|')).digest('hex');

/** The browser's per-request nonce: 32-128 URL-safe characters. */
export const NONCE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export const hashNonce = (nonce: string): string => createHash('sha256').update(nonce).digest('hex');

/** "j•••@g•••.com": enough to recognise, never the address. */
export const maskEmail = (email: string): string => {
  const [local, domain = ''] = email.split('@');
  const dot = domain.lastIndexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${local.slice(0, 1)}•••@${host.slice(0, 1)}•••${tld}`;
};

/** Coarse "Chrome on Mac" from a user agent, for the code email. Never the raw string. */
export const describeDevice = (ua: string | undefined): string => {
  const s = ua ?? '';
  const browser = /Edg\//.test(s) ? 'Edge'
    : /Firefox\//.test(s) ? 'Firefox'
      : /Chrome\//.test(s) ? 'Chrome'
        : /Safari\//.test(s) ? 'Safari'
          : null;
  const os = /iPhone|iPad/.test(s) ? 'iPhone or iPad'
    : /Android/.test(s) ? 'Android'
      : /Mac OS X|Macintosh/.test(s) ? 'Mac'
        : /Windows/.test(s) ? 'Windows'
          : /Linux/.test(s) ? 'Linux'
            : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? 'an unknown device';
};
