/**
 * S-2FA configuration, read on use (never at import) so tests can set env per case.
 *
 * WEBAUTHN_RP_ID must be the host the browser shows (staging:
 * d1bwev65w7rqzl.cloudfront.net). A passkey is bound to it for life, so a
 * passkey made on staging never works on production. That is expected.
 */

import { AppError } from '../errors';
import { log } from '../logger';

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    // An AppError is not logged by the route wrapper, so say it here. Name only.
    log.error('mfa_config_missing', { name });
    throw new AppError('unavailable', 'Two-step sign-in is not available right now', { missing: name });
  }
  return value;
};

const positiveInt = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export interface WebAuthnConfig {
  rpId: string;
  rpName: string;
  origins: string[];
}

/**
 * WEBAUTHN_ORIGINS is optional: unset, the only allowed origin is
 * `https://<WEBAUTHN_RP_ID>` (frees an App Runner env slot, Ph3a). Set it only
 * when a second origin (a subdomain) must be allowed.
 */
export const webAuthnConfig = (): WebAuthnConfig => {
  const rpId = required('WEBAUTHN_RP_ID');
  const listed = (process.env.WEBAUTHN_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return {
    rpId,
    rpName: process.env.WEBAUTHN_RP_NAME?.trim() || 'Authentic Materials',
    origins: listed.length > 0 ? listed : [`https://${rpId}`],
  };
};

/** How long a passkey challenge stays usable. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** How long a step-up grant stays usable. */
export const STEP_UP_TTL_MS = 2 * 60 * 1000;

/**
 * How long a password / email change permit stays usable (Ph2b). Long enough
 * for the browser to call GoTrue right after; spent by the auth.users trigger.
 */
export const ACCOUNT_CHANGE_PERMIT_TTL_MS = 2 * 60 * 1000;

/** Second-factor marker lifetime for everyone except super_admin. */
export const mfaSessionTtlMs = (): number =>
  positiveInt(process.env.MFA_SESSION_TTL_HOURS, 12) * 60 * 60 * 1000;

/** super_admin is the break-glass account (Boss, 2026-10-27): 1 hour. */
export const SUPER_ADMIN_SESSION_TTL_MS = 60 * 60 * 1000;

export const RECOVERY_CODE_COUNT = 10;

/**
 * A sign-in method added with a step-up that a code (authenticator or backup
 * code) confirmed waits this long before it can confirm any step-up. It may
 * still sign in. (Boss, 2026-10-27, S-2FA review M1.)
 */
export const NEW_METHOD_COOL_OFF_MS = 24 * 60 * 60 * 1000;

/** 32-byte key, base64. Encrypts TOTP secrets. */
export const mfaSecretKey = (): Buffer => {
  const key = Buffer.from(required('MFA_SECRET_KEY'), 'base64');
  if (key.length !== 32) {
    log.error('mfa_config_invalid', { name: 'MFA_SECRET_KEY' });
    throw new AppError('unavailable', 'Two-step sign-in is not available right now', { invalid: 'MFA_SECRET_KEY' });
  }
  return key;
};

/** Server-side pepper for recovery-code hashes (a database read alone cannot test guesses). */
export const recoveryPepper = (): string => required('MFA_RECOVERY_PEPPER');
