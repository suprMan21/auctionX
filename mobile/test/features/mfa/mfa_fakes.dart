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
/// Phase C calls answer from the fields below; [failOn] makes one call throw.
class FakeMfaApi implements MfaApi {
  FakeMfaApi({
    this.result = const SignInResult(method: SignInMethod.passkey),
    this.error,
    this.statusValue,
    this.backupCodes,
    this.usableFrom,
    this.otherSessionsEnded = true,
  });

  SignInResult result;
  Object? error;
  final calls = <String>[];

  /// What status() returns (list = one per call, last repeats).
  MfaStatus? statusValue;
  List<String>? backupCodes;
  DateTime? usableFrom;
  bool otherSessionsEnded;
  final failOn = <String, Object>{};

  /// Step-up tokens received with each call, by call name.
  final grants = <String, String?>{};

  void _call(String name, [String? grant]) {
    calls.add(name);
    grants[name.split(':').first] = grant;
    final f = failOn[name.split(':').first];
    if (f != null) throw f;
  }

  @override
  Future<AssertionOptions> stepUpOptions(StepUpAction action, String targetId) async {
    _call('stepUpOptions:${action.wire}:$targetId');
    return const AssertionOptions(challengeId: '33333333-3333-4333-8333-333333333333', options: {'challenge': 'c'});
  }

  @override
  Future<StepUpGrant> stepUpWithPasskey(String challengeId, Map<String, dynamic> response) async {
    _call('stepUpPasskey:$challengeId');
    return StepUpGrant(token: 'grant-passkey', expiresAt: DateTime.utc(2030));
  }

  @override
  Future<StepUpGrant> stepUpWithAuthenticatorCode(StepUpAction action, String targetId, String code) async {
    _call('stepUpTotp:${action.wire}:$targetId:$code');
    return StepUpGrant(token: 'grant-totp', expiresAt: DateTime.utc(2030));
  }

  @override
  Future<StepUpGrant> stepUpWithBackupCode(StepUpAction action, String targetId, String code) async {
    _call('stepUpBackup:${action.wire}:$targetId:$code');
    return StepUpGrant(token: 'grant-backup', expiresAt: DateTime.utc(2030));
  }

  @override
  Future<RegisterOptions> passkeyRegisterOptions({String? stepUpToken}) async {
    _call('registerOptions', stepUpToken);
    return const RegisterOptions(
      challengeId: '44444444-4444-4444-8444-444444444444',
      options: {'challenge': 'c', 'rp': {'id': 'web.example.com', 'name': 'AM'}},
    );
  }

  @override
  Future<PasskeyAdded> passkeyRegisterVerify({
    required String challengeId,
    required String nickname,
    required Map<String, dynamic> response,
  }) async {
    _call('registerVerify:$nickname');
    return PasskeyAdded(
      passkey: PasskeySummary(
        id: 'p2',
        nickname: nickname,
        synced: true,
        createdAt: DateTime.utc(2026, 10, 28),
        usableFrom: usableFrom,
      ),
      backupCodes: backupCodes,
      otherSessionsEnded: otherSessionsEnded,
    );
  }

  @override
  Future<void> renamePasskey(String id, String nickname) async => _call('rename:$id:$nickname');

  @override
  Future<MethodRemoved> removePasskey(String id, String stepUpToken) async {
    _call('removePasskey:$id', stepUpToken);
    return MethodRemoved(otherSessionsEnded: otherSessionsEnded);
  }

  @override
  Future<TotpSetup> totpSetup({String? stepUpToken}) async {
    _call('totpSetup', stepUpToken);
    return const TotpSetup(
      secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
      otpauthUri: 'otpauth://totp/Authentic%20Materials:a%40b.co?secret=JBSWY3DPEHPK3PXP&issuer=Authentic%20Materials',
    );
  }

  @override
  Future<TotpConfirmed> totpConfirm(String code) async {
    _call('totpConfirm:$code');
    return TotpConfirmed(usableFrom: usableFrom, backupCodes: backupCodes, otherSessionsEnded: otherSessionsEnded);
  }

  @override
  Future<MethodRemoved> removeTotp(String stepUpToken) async {
    _call('removeTotp', stepUpToken);
    return MethodRemoved(otherSessionsEnded: otherSessionsEnded);
  }

  @override
  Future<NewBackupCodes> regenerateBackupCodes(String stepUpToken) async {
    _call('regenerate', stepUpToken);
    return NewBackupCodes(codes: backupCodes ?? const ['aaaa-bbbb'], otherSessionsEnded: otherSessionsEnded);
  }

  Future<SignInResult> _answer(String call) async {
    calls.add(call);
    if (error != null) throw error!;
    return result;
  }

  @override
  Future<MfaStatus> status() async {
    calls.add('status');
    final f = failOn['status'];
    if (f != null) throw f;
    return statusValue ?? (throw UnimplementedError());
  }

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
