import '../../../core/network/api_client.dart';
import 'mfa_models.dart';

/// Typed client for `/api/v1/auth/mfa`: the sign-in second step, step-up,
/// and managing sign-in methods. Request bodies match the backend's strict
/// Zod schemas exactly (unknown keys are refused).
class MfaApi {
  const MfaApi(this._api);

  final ApiClient _api;

  static const _base = '/auth/mfa';

  /// Header the backend reads a step-up grant from.
  static const stepUpHeader = 'X-Step-Up';

  static Map<String, String>? _grant(String? token) => token == null ? null : {stepUpHeader: token};

  Future<MfaStatus> status() async => _parse(MfaStatus.fromJson, await _api.get('$_base/status'));

  Future<AssertionOptions> signInOptions() async =>
      _parse(AssertionOptions.fromJson, await _api.post('$_base/sign-in/options'));

  Future<SignInResult> signInWithPasskey(String challengeId, Map<String, dynamic> response) async =>
      _parse(
        SignInResult.fromJson,
        await _api.post('$_base/sign-in/verify', body: {
          'passkey': {'challengeId': challengeId, 'response': response},
        }),
      );

  Future<SignInResult> signInWithAuthenticatorCode(String code) async => _parse(
        SignInResult.fromJson,
        await _api.post('$_base/sign-in/verify', body: {
          'totp': {'code': code.trim()},
        }),
      );

  Future<SignInResult> signInWithBackupCode(String code) async => _parse(
        SignInResult.fromJson,
        await _api.post('$_base/sign-in/verify', body: {
          'recoveryCode': {'code': code.trim()},
        }),
      );

  // ── Step-up ──

  Future<AssertionOptions> stepUpOptions(StepUpAction action, String targetId) async => _parse(
        AssertionOptions.fromJson,
        await _api.post('$_base/step-up/options', body: {'action': action.wire, 'targetId': targetId}),
      );

  Future<StepUpGrant> stepUpWithPasskey(String challengeId, Map<String, dynamic> response) async => _parse(
        StepUpGrant.fromJson,
        await _api.post('$_base/step-up/verify', body: {'challengeId': challengeId, 'response': response}),
      );

  Future<StepUpGrant> stepUpWithAuthenticatorCode(StepUpAction action, String targetId, String code) async =>
      _parse(
        StepUpGrant.fromJson,
        await _api.post('$_base/step-up/verify', body: {
          'action': action.wire,
          'targetId': targetId,
          'totp': {'code': code.trim()},
        }),
      );

  Future<StepUpGrant> stepUpWithBackupCode(StepUpAction action, String targetId, String code) async => _parse(
        StepUpGrant.fromJson,
        await _api.post('$_base/step-up/verify', body: {
          'action': action.wire,
          'targetId': targetId,
          'recoveryCode': {'code': code.trim()},
        }),
      );

  // ── Passkeys ──

  /// [stepUpToken] is needed for every passkey except the account's first method.
  Future<RegisterOptions> passkeyRegisterOptions({String? stepUpToken}) async => _parse(
        RegisterOptions.fromJson,
        await _api.post('$_base/passkeys/register/options', headers: _grant(stepUpToken)),
      );

  Future<PasskeyAdded> passkeyRegisterVerify({
    required String challengeId,
    required String nickname,
    required Map<String, dynamic> response,
  }) async =>
      _parse(
        PasskeyAdded.fromJson,
        await _api.post('$_base/passkeys/register/verify', body: {
          'challengeId': challengeId,
          'nickname': nickname.trim(),
          'response': response,
        }),
      );

  Future<void> renamePasskey(String id, String nickname) async {
    await _api.patch('$_base/passkeys/${Uri.encodeComponent(id)}', body: {'nickname': nickname.trim()});
  }

  /// Needs a `factor_remove` grant for `passkey:<id>`.
  Future<MethodRemoved> removePasskey(String id, String stepUpToken) async => _parse(
        MethodRemoved.fromJson,
        await _api.delete('$_base/passkeys/${Uri.encodeComponent(id)}', headers: _grant(stepUpToken)),
      );

  // ── Authenticator app ──

  /// [stepUpToken] is needed unless this is the account's first method.
  Future<TotpSetup> totpSetup({String? stepUpToken}) async =>
      _parse(TotpSetup.fromJson, await _api.post('$_base/totp/setup', headers: _grant(stepUpToken)));

  Future<TotpConfirmed> totpConfirm(String code) async =>
      _parse(TotpConfirmed.fromJson, await _api.post('$_base/totp/confirm', body: {'code': code.trim()}));

  /// Needs a `factor_remove` grant for `totp`.
  Future<MethodRemoved> removeTotp(String stepUpToken) async =>
      _parse(MethodRemoved.fromJson, await _api.delete('$_base/totp', headers: _grant(stepUpToken)));

  // ── Backup codes ──

  /// Needs a `recovery_regen` grant for `recovery_codes`. The old codes stop working.
  Future<NewBackupCodes> regenerateBackupCodes(String stepUpToken) async => _parse(
        NewBackupCodes.fromJson,
        await _api.post('$_base/recovery-codes/regenerate', headers: _grant(stepUpToken)),
      );

  /// A response we can't read is a server problem, not a crash.
  static T _parse<T>(T Function(Map<String, dynamic>) from, Map<String, dynamic> json) {
    try {
      return from(json);
    } on MfaFormatException {
      throw const ApiException(message: 'Unexpected response from the server.', code: 'bad_response');
    } on FormatException {
      throw const ApiException(message: 'Unexpected response from the server.', code: 'bad_response');
    }
  }
}
