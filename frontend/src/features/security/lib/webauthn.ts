/**
 * Thin wrapper over @simplewebauthn/browser so screens get one of three plain
 * outcomes instead of DOMException names. The word "WebAuthn" never reaches
 * the UI.
 */

import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/browser';

export type PasskeyFailure = 'cancelled' | 'unsupported' | 'already_added' | 'failed';

export class PasskeyError extends Error {
  constructor(readonly kind: PasskeyFailure) {
    super(kind);
    this.name = 'PasskeyError';
  }
}

export const passkeysSupported = (): boolean => {
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
};

const failureOf = (err: unknown): PasskeyFailure => {
  const name = err instanceof Error ? err.name : '';
  // NotAllowedError covers "user closed the prompt" and "timed out"; both read as cancelled.
  if (name === 'NotAllowedError' || name === 'AbortError') return 'cancelled';
  if (name === 'InvalidStateError') return 'already_added';
  if (name === 'NotSupportedError' || name === 'SecurityError') return 'unsupported';
  return 'failed';
};

export const createPasskey = async (optionsJSON: PublicKeyCredentialCreationOptionsJSON): Promise<RegistrationResponseJSON> => {
  if (!passkeysSupported()) throw new PasskeyError('unsupported');
  try {
    return await startRegistration({ optionsJSON });
  } catch (err) {
    throw new PasskeyError(failureOf(err));
  }
};

export const getPasskeyAssertion = async (
  optionsJSON: PublicKeyCredentialRequestOptionsJSON,
): Promise<AuthenticationResponseJSON> => {
  if (!passkeysSupported()) throw new PasskeyError('unsupported');
  try {
    return await startAuthentication({ optionsJSON });
  } catch (err) {
    throw new PasskeyError(failureOf(err));
  }
};

export const passkeyFailureCopy: Record<PasskeyFailure, string> = {
  cancelled: 'The passkey prompt was closed. Try again when you are ready.',
  unsupported: 'This browser cannot use passkeys. Try an up-to-date Safari, Chrome or Edge, or use your authenticator app.',
  already_added: 'This device already has a passkey for your account.',
  failed: 'That passkey check did not work. Try again.',
};
