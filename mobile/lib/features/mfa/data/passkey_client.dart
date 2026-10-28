/// The app's only view of passkeys. The Corbado `passkeys` package sits behind
/// it (Locked 2026-10-28), so it can be swapped without touching screens, and
/// tests use [FakePasskeyClient].
library;

/// Our own closed set of passkey failures. Screens branch on these, never on
/// platform error text.
enum PasskeyFailure {
  /// The person closed the sheet.
  cancelled,

  /// No passkey for this account on this phone or its password manager.
  noCredential,

  /// The phone can't do passkeys (no screen lock, too old, no Google Play services).
  unsupported,

  /// The app isn't linked to the website's domain (association file / entitlement).
  /// A setup problem on our side, never the person's.
  notAssociated,

  timeout,

  /// Anything else; the raw error is logged.
  failed,
}

class PasskeyException implements Exception {
  const PasskeyException(this.failure, [this.detail]);
  final PasskeyFailure failure;

  /// Raw platform error, for logs only.
  final String? detail;

  @override
  String toString() => 'PasskeyException($failure${detail == null ? '' : ': $detail'})';
}

abstract class PasskeyClient {
  /// Shows the OS passkey sheet for the server's request options (WebAuthn
  /// JSON) and returns the assertion as WebAuthn JSON for the server.
  /// Throws [PasskeyException].
  Future<Map<String, dynamic>> getAssertion(Map<String, dynamic> options);
}

/// Fills `transports: []` on every `allowCredentials` entry that lacks it:
/// the package's parser requires the list (corbado/flutter-passkeys#322), and
/// the server may leave it out.
Map<String, dynamic> withTransports(Map<String, dynamic> options) {
  final allow = options['allowCredentials'];
  if (allow is! List) return options;
  return {
    ...options,
    'allowCredentials': [
      for (final c in allow)
        if (c is Map<String, dynamic>)
          {
            ...c,
            'transports': c['transports'] is List ? c['transports'] : const <String>[],
          }
        else
          c,
    ],
  };
}

/// Test double: returns [result] or throws [failure].
class FakePasskeyClient implements PasskeyClient {
  FakePasskeyClient({this.result, this.failure});

  Map<String, dynamic>? result;
  PasskeyFailure? failure;
  final calls = <Map<String, dynamic>>[];

  @override
  Future<Map<String, dynamic>> getAssertion(Map<String, dynamic> options) async {
    calls.add(options);
    if (failure != null) throw PasskeyException(failure!);
    return result ?? const {};
  }
}
