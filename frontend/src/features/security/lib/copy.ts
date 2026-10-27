/**
 * Plain-language messages for the closed set of server reasons (lib/mfa
 * MfaReason). Wording rule: "passkey", "Face ID or fingerprint", "backup
 * codes", "authenticator app". Never "AAL", "WebAuthn" or "MFA".
 */

import { MfaApiError } from '../api/mfaApi';
import { PasskeyError, passkeyFailureCopy } from './webauthn';

const REASON_COPY: Record<string, string> = {
  invalid_code: 'That code did not work. Check it and try again.',
  mfa_locked: 'Too many wrong codes. Code entry is paused for 15 minutes. Your passkey still works.',
  passkey_invalid: 'That passkey check did not work. Try again.',
  synced_passkey_not_allowed: 'This account needs a hardware security key, not a passkey saved to a phone or password manager.',
  last_factor: 'Add another way to sign in before removing this one.',
  already_set_up: 'That is already set up.',
  no_passkey: 'Use your passkey to confirm this.',
  passkey_required: 'Staff accounts confirm this with a passkey or security key.',
  backup_code_not_allowed: 'Backup codes can’t confirm this. Use your passkey or authenticator app.',
  not_available: 'That option is not available for this account.',
  second_factor_required: 'Confirm it is you with your passkey or code first.',
  step_up_required: 'Confirm it is you to continue.',
};

export const mfaErrorCopy = (err: unknown): string => {
  if (err instanceof PasskeyError) return passkeyFailureCopy[err.kind];
  if (err instanceof MfaApiError) {
    if (err.reason && REASON_COPY[err.reason]) return REASON_COPY[err.reason];
    if (err.status === 0) return err.message;
    if (err.status === 503) return 'Two-step sign-in is not available right now. Try again in a few minutes.';
    if (err.status === 429) return 'Too many attempts. Wait a minute and try again.';
    // Server text is shown only for 4xx (house rule).
    if (err.status >= 400 && err.status < 500) return err.message;
  }
  return 'Something went wrong. Please try again.';
};

export const isCancelled = (err: unknown): boolean => err instanceof PasskeyError && err.kind === 'cancelled';
