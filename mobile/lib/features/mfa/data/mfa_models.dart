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

  bool get hasPasskey => passkeys.isNotEmpty;

  /// The break-glass account signs in with hardware keys only.
  bool get canUseAuthenticatorApp => authenticatorApp && !breakGlass;
  bool get canUseBackupCode => backupCodesLeft > 0;

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
