import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:passkeys/authenticator.dart';
import 'package:passkeys/types.dart';

import 'passkey_client.dart';

/// [PasskeyClient] on the Corbado `passkeys` package, used without any
/// Corbado backend: our server makes and checks every challenge.
class CorbadoPasskeyClient implements PasskeyClient {
  CorbadoPasskeyClient([PasskeyAuthenticator? authenticator])
      : _authenticator = authenticator ?? PasskeyAuthenticator();

  final PasskeyAuthenticator _authenticator;

  @override
  Future<Map<String, dynamic>> getAssertion(Map<String, dynamic> options) async {
    final AuthenticateRequestType request;
    try {
      request = AuthenticateRequestType.fromJson(
        withTransports(options),
        // An explicit tap: show the sheet even when no passkey is on this phone,
        // so a security key or another device can be used.
        preferImmediatelyAvailableCredentials: false,
      );
    } catch (e) {
      throw PasskeyException(PasskeyFailure.failed, 'bad options: $e');
    }
    try {
      final response = await _authenticator.authenticate(request);
      return response.toJson();
    } catch (e) {
      final mapped = mapPasskeyError(e);
      // Raw error to the log only (corbado/flutter-passkeys#323: messages vary
      // by OS version and are not for people).
      debugPrint('passkey: ${mapped.failure.name} <- $e');
      throw mapped;
    }
  }
}

/// Maps the package's and platform's errors onto [PasskeyFailure].
@visibleForTesting
PasskeyException mapPasskeyError(Object e) {
  final detail = e.toString();
  return switch (e) {
    PasskeyException() => e,
    PasskeyAuthCancelledException() => PasskeyException(PasskeyFailure.cancelled, detail),
    NoCredentialsAvailableException() => PasskeyException(PasskeyFailure.noCredential, detail),
    DomainNotAssociatedException() => PasskeyException(PasskeyFailure.notAssociated, detail),
    DeviceNotSupportedException() ||
    PasskeyUnsupportedException() ||
    MissingGoogleSignInException() ||
    SyncAccountNotAvailableException() =>
      PasskeyException(PasskeyFailure.unsupported, detail),
    TimeoutException() => PasskeyException(PasskeyFailure.timeout, detail),
    PlatformException(code: 'cancelled') => PasskeyException(PasskeyFailure.cancelled, detail),
    _ => PasskeyException(PasskeyFailure.failed, detail),
  };
}
