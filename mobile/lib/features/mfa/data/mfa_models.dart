/// Shapes returned by `/api/v1/auth/mfa`, mirroring the web client
/// (`frontend/src/features/security/api/mfaApi.ts`). Parsing is strict on the
/// fields the app branches on and lenient on the ones older backends leave out.
library;

class MfaFormatException implements Exception {
  const MfaFormatException(this.field);
  final String field;
  @override
  String toString() => 'MfaFormatException($field)';
}

T _req<T>(Map<String, dynamic> json, String key) {
  final v = json[key];
  if (v is T) return v;
  throw MfaFormatException(key);
}

T? _opt<T>(Map<String, dynamic> json, String key) {
  final v = json[key];
  return v is T ? v : null;
}

DateTime? _date(Map<String, dynamic> json, String key) {
  final v = _opt<String>(json, key);
  return v == null ? null : DateTime.tryParse(v);
}

class PasskeySummary {
  const PasskeySummary({
    required this.id,
    required this.nickname,
    required this.synced,
    required this.createdAt,
    this.lastUsedAt,
    this.usableFrom,
  });

  factory PasskeySummary.fromJson(Map<String, dynamic> json) => PasskeySummary(
        id: _req<String>(json, 'id'),
        nickname: _req<String>(json, 'nickname'),
        synced: _req<bool>(json, 'synced'),
        createdAt: DateTime.parse(_req<String>(json, 'createdAt')),
        lastUsedAt: _date(json, 'lastUsedAt'),
        usableFrom: _date(json, 'usableFrom'),
      );

  final String id;
  final String nickname;
  final bool synced;
  final DateTime createdAt;
  final DateTime? lastUsedAt;

  /// Set while a passkey added with a code waits 24 h before it can confirm anything.
  final DateTime? usableFrom;
}

/// `GET /auth/mfa/status`.
class MfaStatus {
  const MfaStatus({
    required this.passkeys,
    required this.authenticatorApp,
    required this.backupCodesLeft,
    required this.hasFactor,
    required this.sessionVerified,
    required this.enrolmentRequired,
    required this.breakGlass,
    required this.isStaff,
    this.codeEntryLockedUntil,
    this.authenticatorAppUsableFrom,
  });

  factory MfaStatus.fromJson(Map<String, dynamic> json) {
    final list = _req<List<dynamic>>(json, 'passkeys');
    return MfaStatus(
      passkeys: [
        for (final p in list)
          if (p is Map<String, dynamic>) PasskeySummary.fromJson(p) else throw const MfaFormatException('passkeys'),
      ],
      authenticatorApp: _req<bool>(json, 'authenticatorApp'),
      backupCodesLeft: _req<int>(json, 'backupCodesLeft'),
      hasFactor: _req<bool>(json, 'hasFactor'),
      sessionVerified: _req<bool>(json, 'sessionVerified'),
      enrolmentRequired: _req<bool>(json, 'enrolmentRequired'),
      breakGlass: _req<bool>(json, 'breakGlass'),
      isStaff: _opt<bool>(json, 'isStaff') ?? false,
      codeEntryLockedUntil: _date(json, 'codeEntryLockedUntil'),
      authenticatorAppUsableFrom: _date(json, 'authenticatorAppUsableFrom'),
    );
  }

  final List<PasskeySummary> passkeys;
  final bool authenticatorApp;
  final int backupCodesLeft;
  final bool hasFactor;

  /// This sign-in has done its second step.
  final bool sessionVerified;

  /// No method yet, and this account must have one to sign in.
  final bool enrolmentRequired;
  final bool breakGlass;
  final bool isStaff;
  final DateTime? codeEntryLockedUntil;

  /// Set while an authenticator app added with a code waits 24 h.
  final DateTime? authenticatorAppUsableFrom;

  bool get hasPasskey => passkeys.isNotEmpty;

  /// The break-glass account signs in with hardware keys only.
  bool get canUseAuthenticatorApp => authenticatorApp && !breakGlass;
  bool get canUseBackupCode => backupCodesLeft > 0;

  /// Passkeys plus the authenticator app (backup codes don't count). The last
  /// one can never be removed.
  int get methodCount => passkeys.length + (authenticatorApp ? 1 : 0);

  bool codesLockedAt(DateTime now) =>
      codeEntryLockedUntil != null && codeEntryLockedUntil!.isAfter(now);
}

/// `POST /auth/mfa/sign-in/options` (and step-up options): the server's
/// passkey request, passed to the platform untouched apart from #322.
class AssertionOptions {
  const AssertionOptions({required this.challengeId, required this.options});

  factory AssertionOptions.fromJson(Map<String, dynamic> json) => AssertionOptions(
        challengeId: _req<String>(json, 'challengeId'),
        options: _req<Map<String, dynamic>>(json, 'options'),
      );

  final String challengeId;
  final Map<String, dynamic> options;
}

enum SignInMethod { passkey, totp, recoveryCode }

/// `POST /auth/mfa/sign-in/verify`.
class SignInResult {
  const SignInResult({required this.method, this.backupCodesLeft});

  factory SignInResult.fromJson(Map<String, dynamic> json) {
    final method = switch (_req<String>(json, 'method')) {
      'passkey' => SignInMethod.passkey,
      'totp' => SignInMethod.totp,
      'recovery_code' => SignInMethod.recoveryCode,
      _ => throw const MfaFormatException('method'),
    };
    return SignInResult(method: method, backupCodesLeft: _opt<int>(json, 'backupCodesLeft'));
  }

  final SignInMethod method;

  /// Set when a backup code was used.
  final int? backupCodesLeft;
}

/// `POST /auth/mfa/passkeys/register/options`: the server's WebAuthn creation
/// options, passed to the platform untouched apart from the transports fill.
class RegisterOptions {
  const RegisterOptions({required this.challengeId, required this.options});

  factory RegisterOptions.fromJson(Map<String, dynamic> json) => RegisterOptions(
        challengeId: _req<String>(json, 'challengeId'),
        options: _req<Map<String, dynamic>>(json, 'options'),
      );

  final String challengeId;
  final Map<String, dynamic> options;
}

List<String>? _codes(Map<String, dynamic> json, String key) {
  final v = json[key];
  if (v == null) return null;
  if (v is List && v.every((c) => c is String)) return v.cast<String>();
  throw MfaFormatException(key);
}

/// `POST /auth/mfa/passkeys/register/verify`.
class PasskeyAdded {
  const PasskeyAdded({required this.passkey, this.backupCodes, required this.otherSessionsEnded});

  factory PasskeyAdded.fromJson(Map<String, dynamic> json) => PasskeyAdded(
        passkey: PasskeySummary.fromJson(_req<Map<String, dynamic>>(json, 'passkey')),
        backupCodes: _codes(json, 'backupCodes'),
        otherSessionsEnded: _opt<bool>(json, 'otherSessionsEnded') ?? false,
      );

  final PasskeySummary passkey;

  /// Only for the first method: shown once.
  final List<String>? backupCodes;
  final bool otherSessionsEnded;
}

/// `POST /auth/mfa/totp/setup`.
class TotpSetup {
  const TotpSetup({required this.secret, required this.otpauthUri});

  factory TotpSetup.fromJson(Map<String, dynamic> json) {
    final uri = _req<String>(json, 'otpauthUri');
    if (!uri.startsWith('otpauth://')) throw const MfaFormatException('otpauthUri');
    return TotpSetup(secret: _req<String>(json, 'secret'), otpauthUri: uri);
  }

  /// Base32, for typing into an authenticator app by hand.
  final String secret;
  final String otpauthUri;
}

/// `POST /auth/mfa/totp/confirm`.
class TotpConfirmed {
  const TotpConfirmed({this.usableFrom, this.backupCodes, required this.otherSessionsEnded});

  factory TotpConfirmed.fromJson(Map<String, dynamic> json) {
    if (json['authenticatorApp'] != true) throw const MfaFormatException('authenticatorApp');
    return TotpConfirmed(
      usableFrom: _date(json, 'authenticatorAppUsableFrom'),
      backupCodes: _codes(json, 'backupCodes'),
      otherSessionsEnded: _opt<bool>(json, 'otherSessionsEnded') ?? false,
    );
  }

  final DateTime? usableFrom;
  final List<String>? backupCodes;
  final bool otherSessionsEnded;
}

/// `POST /auth/mfa/recovery-codes/regenerate`.
class NewBackupCodes {
  const NewBackupCodes({required this.codes, required this.otherSessionsEnded});

  factory NewBackupCodes.fromJson(Map<String, dynamic> json) => NewBackupCodes(
        codes: _codes(json, 'backupCodes') ?? (throw const MfaFormatException('backupCodes')),
        otherSessionsEnded: _opt<bool>(json, 'otherSessionsEnded') ?? false,
      );

  final List<String> codes;
  final bool otherSessionsEnded;
}

/// `DELETE /auth/mfa/passkeys/:id` and `DELETE /auth/mfa/totp`.
class MethodRemoved {
  const MethodRemoved({required this.otherSessionsEnded});

  factory MethodRemoved.fromJson(Map<String, dynamic> json) {
    _req<String>(json, 'removed');
    return MethodRemoved(otherSessionsEnded: _opt<bool>(json, 'otherSessionsEnded') ?? false);
  }

  final bool otherSessionsEnded;
}

/// Actions a step-up can be asked for from the app (backend StepUpAction).
/// S-MOB2 adds sealing.
enum StepUpAction {
  factorAdd('factor_add'),
  factorRemove('factor_remove'),
  recoveryRegen('recovery_regen');

  const StepUpAction(this.wire);
  final String wire;
}

/// `POST /auth/mfa/step-up/verify`: single use, about 2 minutes, for one
/// action on one target. Sent back in the `X-Step-Up` header.
class StepUpGrant {
  const StepUpGrant({required this.token, required this.expiresAt});

  factory StepUpGrant.fromJson(Map<String, dynamic> json) {
    final token = _req<String>(json, 'stepUpToken');
    if (token.isEmpty) throw const MfaFormatException('stepUpToken');
    return StepUpGrant(token: token, expiresAt: DateTime.parse(_req<String>(json, 'expiresAt')));
  }

  final String token;
  final DateTime expiresAt;
}
