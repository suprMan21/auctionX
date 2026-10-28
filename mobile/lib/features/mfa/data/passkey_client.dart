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

  /// Making a passkey: this phone or password manager already has one for
  /// this account.
  alreadyOnThisDevice,

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

  /// Shows the OS sheet that makes a new passkey for the server's creation
  /// options (WebAuthn JSON) and returns the registration as WebAuthn JSON.
  /// Throws [PasskeyException].
  Future<Map<String, dynamic>> create(Map<String, dynamic> options);
}

/// Fills `transports: []` on every `allowCredentials` entry that lacks it:
/// the package's parser requires the list (corbado/flutter-passkeys#322), and
/// the server may leave it out.
/// Same for `excludeCredentials` when making a passkey.
Map<String, dynamic> withTransports(Map<String, dynamic> options, {String key = 'allowCredentials'}) {
  final allow = options[key];
  if (allow is! List) return options;
  return {
    ...options,
    key: [
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

/// The server's base64url regex refuses `=` padding; some platform versions add it.
Map<String, dynamic> withoutPadding(Map<String, dynamic> credential) {
  String? unpad(Object? v) => v is String ? v.replaceAll(RegExp(r'=+$'), '') : null;
  final response = credential['response'];
  return {
    ...credential,
    if (credential['id'] is String) 'id': unpad(credential['id']),
    if (credential['rawId'] is String) 'rawId': unpad(credential['rawId']),
    if (response is Map<String, dynamic>)
      'response': {
        for (final e in response.entries) e.key: e.value is String ? unpad(e.value) : e.value,
      },
  };
}

/// Test double: returns [result] / [created] or throws [failure].
class FakePasskeyClient implements PasskeyClient {
  FakePasskeyClient({this.result, this.created, this.failure});

  Map<String, dynamic>? result;
  Map<String, dynamic>? created;
  PasskeyFailure? failure;
  final calls = <Map<String, dynamic>>[];
  final createCalls = <Map<String, dynamic>>[];

  @override
  Future<Map<String, dynamic>> getAssertion(Map<String, dynamic> options) async {
    calls.add(options);
    if (failure != null) throw PasskeyException(failure!);
    return result ?? const {};
  }

  @override
  Future<Map<String, dynamic>> create(Map<String, dynamic> options) async {
    createCalls.add(options);
    if (failure != null) throw PasskeyException(failure!);
    return created ?? const {'id': 'new-cred'};
  }
}
