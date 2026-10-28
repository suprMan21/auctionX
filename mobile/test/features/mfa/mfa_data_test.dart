import 'package:authentic_materials/core/network/api_client.dart';
import 'package:authentic_materials/features/mfa/data/corbado_passkey_client.dart';
import 'package:authentic_materials/features/mfa/data/mfa_api.dart';
import 'package:authentic_materials/features/mfa/data/mfa_models.dart';
import 'package:authentic_materials/features/mfa/data/passkey_client.dart';
import 'package:authentic_materials/features/mfa/mfa_copy.dart';
import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:passkeys/types.dart';

import '../../core/api_client_test.dart' show FakeAdapter, client;
import 'mfa_fakes.dart';

MfaApi apiWith(FakeAdapter adapter) => MfaApi(ApiClient(
      baseUrl: 'https://api.example.com/api/v1',
      client: client,
      accessToken: () => 'tok',
      dio: Dio()..httpClientAdapter = adapter,
    ));

void main() {
  group('MfaStatus', () {
    test('parses the backend status, including the fields the app branches on', () {
      final s = MfaStatus.fromJson(statusJson(
        passkeys: [passkeyJson],
        authenticatorApp: true,
        backupCodesLeft: 8,
        codeEntryLockedUntil: '2026-10-28T15:00:00.000Z',
      ));
      expect(s.hasPasskey, isTrue);
      expect(s.passkeys.single.nickname, 'iPhone');
      expect(s.canUseAuthenticatorApp, isTrue);
      expect(s.canUseBackupCode, isTrue);
      expect(s.sessionVerified, isFalse);
      expect(s.codesLockedAt(DateTime.utc(2026, 10, 28, 14)), isTrue);
      expect(s.codesLockedAt(DateTime.utc(2026, 10, 28, 16)), isFalse);
    });

    test('break-glass never offers the authenticator app', () {
      expect(status(passkey: true, totp: true, breakGlass: true).canUseAuthenticatorApp, isFalse);
    });

    test('older backends without isStaff still parse', () {
      final json = statusJson()..remove('isStaff');
      expect(MfaStatus.fromJson(json).isStaff, isFalse);
    });

    test('a missing required field is a format error', () {
      final json = statusJson()..remove('sessionVerified');
      expect(() => MfaStatus.fromJson(json), throwsA(isA<MfaFormatException>()));
    });
  });

  group('MfaApi', () {
    test('status → GET /auth/mfa/status', () async {
      final adapter = FakeAdapter(200, {'success': true, 'data': statusJson(), 'error': null});
      await apiWith(adapter).status();
      expect(adapter.last!.method, 'GET');
      expect(adapter.last!.path, endsWith('/auth/mfa/status'));
    });

    test('sign-in bodies match the backend schema exactly', () async {
      final adapter = FakeAdapter(200, {
        'success': true,
        'data': {'method': 'recovery_code', 'backupCodesLeft': 2},
      });
      final api = apiWith(adapter);

      final r = await api.signInWithBackupCode(' abcd-efgh ');
      expect(r.method, SignInMethod.recoveryCode);
      expect(r.backupCodesLeft, 2);
      expect(adapter.last!.data, {
        'recoveryCode': {'code': 'abcd-efgh'},
      });

      await api.signInWithAuthenticatorCode('123456');
      expect(adapter.last!.data, {
        'totp': {'code': '123456'},
      });

      await api.signInWithPasskey('cid', {'id': 'x'});
      expect(adapter.last!.data, {
        'passkey': {
          'challengeId': 'cid',
          'response': {'id': 'x'},
        },
      });
      expect(adapter.last!.path, endsWith('/auth/mfa/sign-in/verify'));
    });

    test('an unreadable success body becomes bad_response, not a crash', () async {
      final adapter = FakeAdapter(200, {
        'success': true,
        'data': {'method': 'sms'},
      });
      expect(
        () => apiWith(adapter).signInWithAuthenticatorCode('123456'),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'bad_response')),
      );
    });

    test('keeps the server reason so the screen can word it', () async {
      final adapter = FakeAdapter(400, {'success': false, 'error': 'Invalid code', 'reason': 'invalid_code'});
      try {
        await apiWith(adapter).signInWithAuthenticatorCode('000000');
        fail('should throw');
      } on ApiException catch (e) {
        expect(mfaErrorCopy(e), 'That code did not work. Check it and try again.');
      }
    });
  });

  group('passkey wrapper', () {
    test('fills transports on allowCredentials (#322) and keeps the rest', () {
      final out = withTransports({
        'challenge': 'c',
        'rpId': 'web.example.com',
        'allowCredentials': [
          {'type': 'public-key', 'id': 'AAA'},
          {'type': 'public-key', 'id': 'BBB', 'transports': ['usb']},
        ],
      });
      final allow = out['allowCredentials'] as List;
      expect(allow[0]['transports'], isEmpty);
      expect(allow[1]['transports'], ['usb']);
      expect(out['rpId'], 'web.example.com');
      // The package can now parse it.
      final req = AuthenticateRequestType.fromJson(out);
      expect(req.allowCredentials, hasLength(2));
    });

    test('options without allowCredentials pass through', () {
      final opts = {'challenge': 'c', 'rpId': 'r'};
      expect(withTransports(opts), same(opts));
    });

    test('maps platform errors onto our closed set', () {
      PasskeyFailure f(Object e) => mapPasskeyError(e).failure;
      expect(f(PasskeyAuthCancelledException()), PasskeyFailure.cancelled);
      expect(f(NoCredentialsAvailableException()), PasskeyFailure.noCredential);
      expect(f(DomainNotAssociatedException('x')), PasskeyFailure.notAssociated);
      expect(f(DeviceNotSupportedException()), PasskeyFailure.unsupported);
      expect(f(MissingGoogleSignInException()), PasskeyFailure.unsupported);
      expect(f(TimeoutException('t')), PasskeyFailure.timeout);
      expect(f(PlatformException(code: 'cancelled')), PasskeyFailure.cancelled);
      expect(f(PlatformException(code: 'weird')), PasskeyFailure.failed);
      expect(f(StateError('x')), PasskeyFailure.failed);
    });

    test('every failure has plain words; cancel is silent', () {
      for (final failure in PasskeyFailure.values) {
        final text = mfaErrorCopy(PasskeyException(failure));
        expect(text, isNot(contains('WebAuthn')));
        expect(text, isNot(contains('MFA')));
      }
      expect(isCancelled(const PasskeyException(PasskeyFailure.cancelled)), isTrue);
      expect(isCancelled(const PasskeyException(PasskeyFailure.failed)), isFalse);
    });
  });
}
