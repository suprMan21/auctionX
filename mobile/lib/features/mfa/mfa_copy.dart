import '../../core/network/api_client.dart';
import 'data/passkey_client.dart';

/// Plain-language messages for the server's closed set of reasons (backend
/// lib/mfa MfaReason) and our passkey failures. Same words as the website:
/// "passkey", "authenticator app", "backup code". Never "MFA" or "WebAuthn".
const _reasonCopy = <String, String>{
  'invalid_code': 'That code did not work. Check it and try again.',
  'mfa_locked': 'Too many wrong codes. Code entry is paused for 15 minutes. Your passkey still works.',
  'passkey_invalid': 'That passkey check did not work. Try again.',
  'synced_passkey_not_allowed':
      'This account needs a hardware security key, not a passkey saved to a phone or password manager.',
  'not_available': 'That option is not available for this account.',
  'second_factor_required': 'Confirm it is you with your passkey or code first.',
  'recovery_freeze': 'Your account was recovered recently, so this is paused for a few days to keep your seals safe.',
  'last_factor': 'Add another way to sign in before removing this one.',
  'already_set_up': 'That is already set up.',
  'no_passkey': 'Use your passkey to confirm this.',
  'passkey_required': 'Staff accounts confirm this with a passkey or security key.',
  'backup_code_not_allowed': 'Backup codes can’t confirm this. Use your passkey or authenticator app.',
  'new_method_waiting':
      'A sign-in method added in the last 24 hours with a code can’t approve this yet. Use one you had before.',
  'step_up_required': 'Confirm it’s you to continue.',
  'recovery_not_available': 'The time to add a sign-in method after recovery is over.',
};

const _passkeyCopy = <PasskeyFailure, String>{
  PasskeyFailure.cancelled: 'The passkey prompt was closed. Try again when you are ready.',
  PasskeyFailure.noCredential:
      'No passkey for this account was found on this phone. Use another way below, or the device that has your passkey.',
  PasskeyFailure.unsupported:
      'This phone can’t use passkeys. Set a screen lock, or use your authenticator app.',
  PasskeyFailure.notAssociated:
      'Passkeys aren’t working in this version of the app. Use your authenticator app or a backup code.',
  PasskeyFailure.timeout: 'The passkey prompt timed out. Try again.',
  PasskeyFailure.failed: 'That passkey check did not work. Try again.',
  PasskeyFailure.alreadyOnThisDevice: 'This phone already has a passkey for your account.',
};

/// Making a passkey fails for different reasons than using one.
const _createCopy = <PasskeyFailure, String>{
  PasskeyFailure.noCredential: 'This phone couldn’t make a passkey. Set a screen lock, or use an authenticator app.',
  PasskeyFailure.unsupported: 'This phone couldn’t make a passkey. Set a screen lock, or use an authenticator app.',
  PasskeyFailure.notAssociated:
      'Passkeys aren’t working in this version of the app. Use an authenticator app for now.',
  PasskeyFailure.failed: 'The passkey wasn’t added. Try again.',
};

/// Message for a failure while making a new passkey.
String passkeyCreateErrorCopy(Object error) {
  if (error is PasskeyException && _createCopy.containsKey(error.failure)) return _createCopy[error.failure]!;
  return mfaErrorCopy(error);
}

String mfaErrorCopy(Object error) {
  if (error is PasskeyException) return _passkeyCopy[error.failure]!;
  if (error is ApiException) {
    final reason = error.reason;
    if (reason != null && _reasonCopy.containsKey(reason)) return _reasonCopy[reason]!;
    if (error.isNetwork) return error.message;
    if (error.status == 503) return 'Two-step sign-in is not available right now. Try again in a few minutes.';
    if (error.status == 429) return 'Too many attempts. Wait a minute and try again.';
    // Server text only for 4xx (house rule); ApiException already applies it.
    final status = error.status ?? 500;
    if (status >= 400 && status < 500) return error.message;
  }
  return 'Something went wrong. Please try again.';
}

bool isCancelled(Object error) => error is PasskeyException && error.failure == PasskeyFailure.cancelled;
