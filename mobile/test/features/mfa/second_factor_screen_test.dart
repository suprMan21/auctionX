import 'package:authentic_materials/app_providers.dart';
import 'package:authentic_materials/core/network/api_client.dart';
import 'package:authentic_materials/features/mfa/data/mfa_models.dart';
import 'package:authentic_materials/features/mfa/data/passkey_client.dart';
import 'package:authentic_materials/features/mfa/presentation/gate_screens.dart';
import 'package:authentic_materials/features/mfa/presentation/second_factor_screen.dart';
import 'package:authentic_materials/features/mfa/session_gate.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';

import '../auth_screens_test.dart' show FakeAuthService, host;
import 'mfa_fakes.dart';

final now = DateTime.utc(2026, 10, 28, 14);

Future<({FakeMfaApi api, FakePasskeyClient passkeys, StubGate gate})> pump(
  WidgetTester tester,
  MfaStatus s, {
  FakeMfaApi? api,
  FakePasskeyClient? passkeys,
  SessionGate? after,
  Widget? screen,
}) async {
  final fakeApi = api ?? FakeMfaApi();
  final fakePasskeys = passkeys ?? FakePasskeyClient(result: {'id': 'cred'});
  // The router moves on after a refresh; without one the gate stays put.
  final gate = StubGate(GateSecondFactor(s), afterRefresh: after);
  // A fresh tree each time, so overrides from an earlier pump don't linger.
  await tester.pumpWidget(const SizedBox());
  await tester.pumpWidget(host(
    screen ?? SecondFactorScreen(now: () => now),
    auth: FakeAuthService(),
    extra: [
      mfaApiProvider.overrideWithValue(fakeApi),
      passkeyClientProvider.overrideWithValue(fakePasskeys),
      sessionGateProvider.overrideWith(() => gate),
    ],
  ));
  return (api: fakeApi, passkeys: fakePasskeys, gate: gate);
}

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  testWidgets('offers only the methods the account has', (tester) async {
    await pump(tester, status(passkey: true));
    expect(find.text('Use passkey'), findsOneWidget);
    expect(find.text('Use authenticator app code'), findsNothing);
    expect(find.text('Use a backup code'), findsNothing);

    await pump(tester, status(totp: true, codes: 4));
    expect(find.text('Use passkey'), findsNothing);
    expect(find.text('Use authenticator app code'), findsOneWidget);
    expect(find.text('Use a backup code'), findsOneWidget);
  });

  testWidgets('passkey: options → OS sheet → verify → gate refresh', (tester) async {
    final r = await pump(tester, status(passkey: true));
    await tester.tap(find.text('Use passkey'));
    await tester.pumpAndSettle();
    expect(r.api.calls, ['options', 'passkey:22222222-2222-4222-8222-222222222222']);
    expect(r.passkeys.calls.single['rpId'], 'web.example.com');
    expect(r.gate.refreshes, 1);
  });

  testWidgets('closing the passkey sheet shows nothing; other failures are worded', (tester) async {
    final r = await pump(tester, status(passkey: true),
        passkeys: FakePasskeyClient(failure: PasskeyFailure.cancelled));
    await tester.tap(find.text('Use passkey'));
    await tester.pumpAndSettle();
    expect(r.api.calls, ['options']);
    expect(r.gate.refreshes, 0);
    expect(find.textContaining('passkey prompt was closed'), findsNothing);

    r.passkeys.failure = PasskeyFailure.noCredential;
    await tester.tap(find.text('Use passkey'));
    await tester.pumpAndSettle();
    expect(find.textContaining('No passkey for this account was found'), findsOneWidget);
  });

  testWidgets('authenticator code: checks format, sends, words a wrong code', (tester) async {
    final r = await pump(tester, status(totp: true),
        api: FakeMfaApi(error: const ApiException(message: 'x', status: 400, reason: 'invalid_code')));
    await tester.tap(find.text('Use authenticator app code'));
    await tester.pumpAndSettle();

    final field = find.widgetWithText(TextField, 'Authenticator app code');
    expect(tester.widget<TextField>(field).autofillHints, contains(AutofillHints.oneTimeCode));

    await tester.enterText(field, '12');
    await tester.tap(find.text('Continue'));
    await tester.pump();
    expect(find.text('Enter the 6-digit code from your authenticator app.'), findsOneWidget);
    expect(r.api.calls, isEmpty);

    await tester.enterText(field, '123456');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(r.api.calls, ['totp:123456']);
    expect(find.text('That code did not work. Check it and try again.'), findsOneWidget);
    expect(r.gate.refreshes, 0);
  });

  testWidgets('backup code: no autofill hint, low-codes notice, then in', (tester) async {
    final r = await pump(tester, status(codes: 3),
        api: FakeMfaApi(result: const SignInResult(method: SignInMethod.recoveryCode, backupCodesLeft: 2)));
    await tester.tap(find.text('Use a backup code'));
    await tester.pumpAndSettle();
    final field = find.widgetWithText(TextField, 'Backup code');
    expect(tester.widget<TextField>(field).autofillHints, isNull);

    await tester.enterText(field, 'abcd-efgh');
    await tester.tap(find.text('Continue'));
    // The button spinner runs while the notice is up: pump, don't settle.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.text('Backup codes running low'), findsOneWidget);
    expect(find.textContaining('You have 2 backup codes left'), findsOneWidget);
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    expect(r.api.calls, ['backup:abcd-efgh']);
    expect(r.gate.refreshes, 1);
  });

  testWidgets('code lock-out disables codes but not the passkey', (tester) async {
    await pump(tester, status(passkey: true, totp: true, codes: 5, lockedUntil: '2026-10-28T14:15:00.000Z'));
    expect(find.textContaining('Too many wrong codes'), findsOneWidget);
    expect(find.textContaining('Your passkey still works.'), findsOneWidget);
    expect(tester.widget<OutlinedButton>(find.widgetWithText(OutlinedButton, 'Use authenticator app code')).onPressed,
        isNull);
    expect(tester.widget<TextButton>(find.widgetWithText(TextButton, 'Use a backup code')).onPressed, isNull);
  });

  testWidgets('recovery link for everyone but staff; sign out always', (tester) async {
    await pump(tester, status(passkey: true));
    expect(find.text('Recover by email'), findsOneWidget);
    expect(find.text('Sign out'), findsOneWidget);

    await pump(tester, status(passkey: true, staff: true));
    expect(find.text('Recover by email'), findsNothing);
    expect(find.text('Sign out'), findsOneWidget);
  });

  testWidgets('survives 200% text size', (tester) async {
    tester.platformDispatcher.textScaleFactorTestValue = 2.0;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await pump(tester, status(passkey: true, totp: true, codes: 5));
    expect(tester.takeException(), isNull);
  });

  testWidgets('creators-only: become a creator, check again, sign out', (tester) async {
    final r = await pump(tester, status(), screen: const CreatorsOnlyScreen());
    expect(find.text('This app is for creators'), findsOneWidget);
    expect(find.text('Become a creator'), findsOneWidget);
    await tester.tap(find.text('Check again'));
    await tester.pumpAndSettle();
    expect(r.gate.refreshes, 1);
    expect(find.text('Sign out'), findsOneWidget);
  });

  testWidgets('set-up required: points to the website and can check again', (tester) async {
    final r = await pump(tester, status(enrol: true), screen: const SetupRequiredScreen());
    expect(find.text('Add a second sign-in step'), findsOneWidget);
    expect(find.text('Set it up on the website'), findsOneWidget);
    await tester.tap(find.text('I’ve set it up'));
    await tester.pumpAndSettle();
    expect(r.gate.refreshes, 1);
  });
}
