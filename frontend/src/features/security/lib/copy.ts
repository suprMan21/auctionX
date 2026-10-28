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
  hardware_key_required: 'This account needs a YubiKey. That key could not be confirmed as one. If your browser asked whether to share details about your key, choose Allow.',
  last_factor: 'Add another way to sign in before removing this one.',
  already_set_up: 'That is already set up.',
  no_passkey: 'Use your passkey to confirm this.',
  passkey_required: 'Staff accounts confirm this with a passkey or security key.',
  backup_code_not_allowed: 'Backup codes can’t confirm this. Use your passkey or authenticator app.',
  new_method_waiting: 'A sign-in method added in the last 24 hours with a code can’t approve this yet. Use one you had before.',
  not_available: 'That option is not available for this account.',
  second_factor_required: 'Confirm it is you with your passkey or code first.',
  step_up_required: 'Confirm it is you to continue.',
  // Ph3b: email-code recovery
  recovery_freeze: 'Your account was recovered recently, so this is paused for a few days to keep your tokens safe.',
  recovery_waiting: 'Your recovery is waiting. You can finish it when the wait ends.',
  recovery_method_not_allowed: 'Use a passkey or authenticator app you added at least 7 days before the recovery started.',
  code_expired: 'This code has expired or was replaced. Ask for a new one.',
  code_locked: 'Too many tries. Ask for a new code.',
  mail_unavailable: 'We can’t send codes right now. Try again in a few minutes.',
  nonce_required: 'Refresh the page and try again.',
  same_as_account_email: 'Use a different address from the one you sign in with.',
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
