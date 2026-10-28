import 'package:authentic_materials/core/network/api_client.dart';
import 'package:authentic_materials/features/mfa/data/corbado_passkey_client.dart';
import 'package:authentic_materials/features/mfa/data/mfa_models.dart';
import 'package:authentic_materials/features/mfa/data/passkey_client.dart';
import 'package:authentic_materials/features/mfa/mfa_copy.dart';
import 'package:authentic_materials/features/mfa/presentation/step_up_sheet.dart';
import 'package:authentic_materials/features/security/method_flows.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:passkeys/types.dart';

import '../../core/api_client_test.dart' show FakeAdapter;
import 'mfa_data_test.dart' show apiWith;
import 'mfa_fakes.dart';

Map<String, dynamic> ok(Object data) => {'success': true, 'data': data, 'error': null};

/// What @simplewebauthn/server's generateRegistrationOptions sends (backend
/// passkeyRegisterOptions), with one existing passkey stored without transports.
final registerOptionsJson = <String, dynamic>{
  'challenge': 'Y2hhbGxlbmdlLWJ5dGVz',
  'rp': {'name': 'Authentic Materials', 'id': 'd1bwev65w7rqzl.cloudfront.net'},
  'user': {'id': 'MTIzNDU2Nzg5MDEyMzQ1Ng', 'name': 'a@b.co', 'displayName': ''},
  'pubKeyCredParams': [
    {'alg': -8, 'type': 'public-key'},
    {'alg': -7, 'type': 'public-key'},
    {'alg': -257, 'type': 'public-key'},
  ],
  'timeout': 60000,
  'attestation': 'none',
  'excludeCredentials': [
    {'id': 'AAAA', 'type': 'public-key'},
    {'id': 'BBBB', 'type': 'public-key', 'transports': ['internal', 'hybrid']},
  ],
  'authenticatorSelection': {'residentKey': 'preferred', 'userVerification': 'required', 'requireResidentKey': false},
  'extensions': {'credProps': true},
  'hints': <String>[],
};

void main() {
  group('models', () {
    test('status: method count and the authenticator app wait', () {
      final s = MfaStatus.fromJson({
        ...statusJson(passkeys: [passkeyJson], authenticatorApp: true, backupCodesLeft: 10),
        'authenticatorAppUsableFrom': '2026-10-29T14:00:00.000Z',
      });
      expect(s.methodCount, 2);
      expect(s.authenticatorAppUsableFrom, DateTime.utc(2026, 10, 29, 14));
      expect(status(passkey: true, codes: 10).methodCount, 1);
    });

    test('passkey added: first method brings codes; later ones may wait', () {
      final first = PasskeyAdded.fromJson({
        'passkey': {'id': 'p', 'nickname': 'iPhone', 'synced': true, 'createdAt': '2026-10-28T10:00:00.000Z', 'usableFrom': null},
        'backupCodes': ['a', 'b'],
        'otherSessionsEnded': true,
      });
      expect(first.backupCodes, ['a', 'b']);
      expect(first.passkey.usableFrom, isNull);
      final later = PasskeyAdded.fromJson({
        'passkey': {
          'id': 'p',
          'nickname': 'iPad',
          'synced': false,
          'createdAt': '2026-10-28T10:00:00.000Z',
          'usableFrom': '2026-10-29T10:00:00.000Z',
        },
        'backupCodes': null,
        'otherSessionsEnded': false,
      });
      expect(later.backupCodes, isNull);
      expect(later.passkey.usableFrom, DateTime.utc(2026, 10, 29, 10));
    });

    test('unreadable answers are format errors', () {
      expect(() => TotpSetup.fromJson({'secret': 'X', 'otpauthUri': 'https://evil'}), throwsA(isA<MfaFormatException>()));
      expect(() => StepUpGrant.fromJson({'stepUpToken': '', 'expiresAt': '2026-10-28T10:00:00Z'}),
          throwsA(isA<MfaFormatException>()));
      expect(() => NewBackupCodes.fromJson({'backupCodes': [1, 2]}), throwsA(isA<MfaFormatException>()));
      expect(() => TotpConfirmed.fromJson({'authenticatorApp': false}), throwsA(isA<MfaFormatException>()));
      expect(() => MethodRemoved.fromJson({}), throwsA(isA<MfaFormatException>()));
    });
  });

  group('MfaApi (manage)', () {
    test('step-up bodies match the backend schema exactly', () async {
      final adapter = FakeAdapter(200, ok({
        'stepUpToken': 'g',
        'expiresAt': '2026-10-28T10:02:00.000Z',
        'action': 'factor_remove',
        'targetId': 'totp',
      }));
      final api = apiWith(adapter);

      await api.stepUpWithAuthenticatorCode(StepUpAction.factorRemove, 'totp', ' 123456 ');
      expect(adapter.last!.data, {
        'action': 'factor_remove',
        'targetId': 'totp',
        'totp': {'code': '123456'},
      });
      await api.stepUpWithBackupCode(StepUpAction.recoveryRegen, 'recovery_codes', 'abcd-efgh');
      expect(adapter.last!.data, {
        'action': 'recovery_regen',
        'targetId': 'recovery_codes',
        'recoveryCode': {'code': 'abcd-efgh'},
      });
      final grant = await api.stepUpWithPasskey('cid', {'id': 'x'});
      expect(adapter.last!.data, {'challengeId': 'cid', 'response': {'id': 'x'}});
      expect(adapter.last!.path, endsWith('/auth/mfa/step-up/verify'));
      expect(grant.token, 'g');
    });

    test('step-up options name the action and target', () async {
      final adapter = FakeAdapter(200, ok({'challengeId': 'c', 'options': {'challenge': 'x'}}));
      await apiWith(adapter).stepUpOptions(StepUpAction.factorAdd, 'passkey');
      expect(adapter.last!.data, {'action': 'factor_add', 'targetId': 'passkey'});
    });

    test('the grant goes in X-Step-Up, never in the body', () async {
      final adapter = FakeAdapter(200, ok({'removed': 'p1', 'otherSessionsEnded': true}));
      final api = apiWith(adapter);
      final r = await api.removePasskey('p1', 'grant-1');
      expect(r.otherSessionsEnded, isTrue);
      expect(adapter.last!.method, 'DELETE');
      expect(adapter.last!.path, endsWith('/auth/mfa/passkeys/p1'));
      expect(adapter.last!.headers['X-Step-Up'], 'grant-1');

      await api.removeTotp('grant-2');
      expect(adapter.last!.path, endsWith('/auth/mfa/totp'));
      expect(adapter.last!.headers['X-Step-Up'], 'grant-2');
    });

    test('the first method is added without a grant header', () async {
      final adapter = FakeAdapter(200, ok({'challengeId': 'c', 'options': registerOptionsJson}));
      final api = apiWith(adapter);
      await api.passkeyRegisterOptions();
      expect(adapter.last!.headers.containsKey('X-Step-Up'), isFalse);
      await api.passkeyRegisterOptions(stepUpToken: 'g');
      expect(adapter.last!.headers['X-Step-Up'], 'g');
    });

    test('register verify body: challengeId, trimmed nickname, response only', () async {
      final adapter = FakeAdapter(201, ok({
        'passkey': {'id': 'p', 'nickname': 'iPhone', 'synced': true, 'createdAt': '2026-10-28T10:00:00.000Z', 'usableFrom': null},
        'backupCodes': null,
        'otherSessionsEnded': true,
      }));
      await apiWith(adapter).passkeyRegisterVerify(challengeId: 'c', nickname: ' iPhone ', response: {'id': 'x'});
      expect(adapter.last!.data, {'challengeId': 'c', 'nickname': 'iPhone', 'response': {'id': 'x'}});
    });

    test('totp confirm and rename bodies', () async {
      final adapter = FakeAdapter(200, ok({'authenticatorApp': true, 'backupCodes': null, 'otherSessionsEnded': true}));
      final api = apiWith(adapter);
      await api.totpConfirm(' 654321 ');
      expect(adapter.last!.data, {'code': '654321'});
      await api.renamePasskey('p1', ' Work key ');
      expect(adapter.last!.method, 'PATCH');
      expect(adapter.last!.data, {'nickname': 'Work key'});
    });

    test('new_method_waiting and last_factor get plain words', () async {
      for (final reason in ['new_method_waiting', 'last_factor', 'step_up_required']) {
        final adapter = FakeAdapter(403, {'success': false, 'error': 'x', 'reason': reason});
        try {
          await apiWith(adapter).removeTotp('g');
          fail('should throw');
        } on ApiException catch (e) {
          final text = mfaErrorCopy(e);
          expect(text, isNot('x'));
          expect(text, isNot(contains('MFA')));
        }
      }
    });
  });

  group('passkey creation wrapper', () {
    test('fills transports on excludeCredentials so the package can parse the server options', () {
      expect(() => RegisterRequestType.fromJson(registerOptionsJson), throwsA(anything));
      final filled = withTransports(registerOptionsJson, key: 'excludeCredentials');
      final req = RegisterRequestType.fromJson(filled);
      expect(req.excludeCredentials, hasLength(2));
      expect(req.excludeCredentials.last.transports, ['internal', 'hybrid']);
      expect(req.relyingParty.id, 'd1bwev65w7rqzl.cloudfront.net');
      expect(req.authSelectionType?.userVerification, 'required');
    });

    test('strips base64 padding the server would refuse', () {
      final out = withoutPadding({
        'id': 'abc=',
        'rawId': 'abc==',
        'type': 'public-key',
        'response': {'clientDataJSON': 'xyz=', 'attestationObject': 'qq', 'transports': ['internal']},
        'clientExtensionResults': <String, dynamic>{},
      });
      expect(out['id'], 'abc');
      expect(out['rawId'], 'abc');
      expect(out['response'], {'clientDataJSON': 'xyz', 'attestationObject': 'qq', 'transports': ['internal']});
    });

    test('a passkey already on this phone, or no way to make one, is worded', () {
      expect(mapPasskeyError(ExcludeCredentialsCanNotBeRegisteredException()).failure, PasskeyFailure.alreadyOnThisDevice);
      expect(mapPasskeyError(NoCreateOptionException('x')).failure, PasskeyFailure.unsupported);
      expect(passkeyCreateErrorCopy(const PasskeyException(PasskeyFailure.unsupported)), contains('Set a screen lock'));
      expect(passkeyCreateErrorCopy(const PasskeyException(PasskeyFailure.alreadyOnThisDevice)),
          contains('already has a passkey'));
    });
  });

  group('rules', () {
    test('changing sign-in methods accepts every way of confirming', () {
      for (final a in StepUpAction.values) {
        expect(allowedStepUpMethods(a), StepUpMethod.values);
      }
    });

    test('nickname check matches the backend', () {
      expect(nicknameProblem('iPhone'), isNull);
      expect(nicknameProblem('   '), isNotNull);
      expect(nicknameProblem('a' * 41), isNotNull);
      expect(nicknameProblem('<b>'), isNotNull);
    });
  });
}
