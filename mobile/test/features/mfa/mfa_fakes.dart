import 'package:authentic_materials/features/account/data/account_type_reader.dart';
import 'package:authentic_materials/features/auth/data/auth_service.dart';
import 'package:authentic_materials/features/mfa/data/mfa_api.dart';
import 'package:authentic_materials/features/mfa/data/mfa_models.dart';
import 'package:authentic_materials/features/mfa/session_gate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// `GET /auth/mfa/status` as the backend sends it (lib/mfa/mfaService getStatus).
Map<String, dynamic> statusJson({
  List<Map<String, dynamic>> passkeys = const [],
  bool authenticatorApp = false,
  int backupCodesLeft = 0,
  bool? hasFactor,
  bool sessionVerified = false,
  bool enrolmentRequired = false,
  bool breakGlass = false,
  bool isStaff = false,
  String? codeEntryLockedUntil,
}) =>
    {
      'passkeys': passkeys,
      'authenticatorApp': authenticatorApp,
      'authenticatorAppUsableFrom': null,
      'backupCodesLeft': backupCodesLeft,
      'hasFactor': hasFactor ?? (passkeys.isNotEmpty || authenticatorApp),
      'sessionVerified': sessionVerified,
      'enrolmentRequired': enrolmentRequired,
      'secondFactorRequired': true,
      'breakGlass': breakGlass,
      'isStaff': isStaff,
      'codeEntryLockedUntil': codeEntryLockedUntil,
      'backupEmail': null,
      'recovery': null,
    };

const passkeyJson = {
  'id': '11111111-1111-4111-8111-111111111111',
  'nickname': 'iPhone',
  'synced': true,
  'createdAt': '2026-10-20T10:00:00.000Z',
  'lastUsedAt': null,
  'usableFrom': null,
  'fromRecovery': false,
};

MfaStatus status({
  bool passkey = false,
  bool totp = false,
  int codes = 0,
  bool verified = false,
  bool enrol = false,
  bool breakGlass = false,
  bool staff = false,
  String? lockedUntil,
}) =>
    MfaStatus.fromJson(statusJson(
      passkeys: passkey ? [passkeyJson] : const [],
      authenticatorApp: totp,
      backupCodesLeft: codes,
      hasFactor: passkey || totp || codes > 0,
      sessionVerified: verified,
      enrolmentRequired: enrol,
      breakGlass: breakGlass,
      isStaff: staff,
      codeEntryLockedUntil: lockedUntil,
    ));

/// Records calls; answers with [result] or throws [error].
class FakeMfaApi implements MfaApi {
  FakeMfaApi({this.result = const SignInResult(method: SignInMethod.passkey), this.error});

  SignInResult result;
  Object? error;
  final calls = <String>[];

  Future<SignInResult> _answer(String call) async {
    calls.add(call);
    if (error != null) throw error!;
    return result;
  }

  @override
  Future<MfaStatus> status() async => throw UnimplementedError();

  @override
  Future<AssertionOptions> signInOptions() async {
    calls.add('options');
    return const AssertionOptions(
      challengeId: '22222222-2222-4222-8222-222222222222',
      options: {'challenge': 'Y2hhbGxlbmdl', 'rpId': 'web.example.com'},
    );
  }

  @override
  Future<SignInResult> signInWithPasskey(String challengeId, Map<String, dynamic> response) =>
      _answer('passkey:$challengeId');

  @override
  Future<SignInResult> signInWithAuthenticatorCode(String code) => _answer('totp:$code');

  @override
  Future<SignInResult> signInWithBackupCode(String code) => _answer('backup:$code');
}

class FakeAccountTypes implements AccountTypeReader {
  FakeAccountTypes(this.type);
  AccountType type;
  Object? error;
  @override
  Future<AccountType> read(String userId) async {
    if (error != null) throw error!;
    return type;
  }
}

/// A gate with a fixed state; refresh() moves to [afterRefresh] when set.
class StubGate extends SessionGateController {
  StubGate(this.initial, {this.afterRefresh})
      : super(
          auth: Provider<AuthStatus>((_) => const SignedOut()),
          loadStatus: (_) => () async => throw UnimplementedError(),
          accountTypes: (_) => FakeAccountTypes(AccountType.creator),
          signOut: (_) async {},
        );

  final SessionGate initial;
  final SessionGate? afterRefresh;
  int refreshes = 0;

  @override
  SessionGate build() => initial;

  @override
  Future<void> refresh({bool quiet = false}) async {
    refreshes++;
    if (afterRefresh != null) state = afterRefresh!;
  }
}
