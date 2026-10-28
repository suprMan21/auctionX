import '../../../core/network/api_client.dart';
import 'mfa_models.dart';

/// Typed client for the sign-in part of `/api/v1/auth/mfa`.
/// Phase C adds methods management and step-up.
class MfaApi {
  const MfaApi(this._api);

  final ApiClient _api;

  static const _base = '/auth/mfa';

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
