import 'package:authentic_materials/app_providers.dart';
import 'package:authentic_materials/features/mfa/data/mfa_models.dart';
import 'package:authentic_materials/features/mfa/data/passkey_client.dart';
import 'package:authentic_materials/features/mfa/presentation/gate_screens.dart';
import 'package:authentic_materials/features/mfa/session_gate.dart';
import 'package:authentic_materials/features/security/authenticator_setup_screen.dart';
import 'package:authentic_materials/features/security/security_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';

import '../auth_screens_test.dart' show FakeAuthService, host;
import '../mfa/mfa_fakes.dart';

final now = DateTime.utc(2026, 10, 28, 14);

const secondPasskey = {
  'id': '55555555-5555-4555-8555-555555555555',
  'nickname': 'YubiKey',
  'synced': false,
  'createdAt': '2026-10-28T12:00:00.000Z',
  'lastUsedAt': null,
  'usableFrom': '2026-10-29T12:00:00.000Z',
  'fromRecovery': false,
};

MfaStatus statusOf({List<Map<String, dynamic>> passkeys = const [passkeyJson], bool totp = false, int codes = 10}) =>
    MfaStatus.fromJson(statusJson(
      passkeys: passkeys,
      authenticatorApp: totp,
      backupCodesLeft: codes,
      sessionVerified: true,
    ));

Future<({FakeMfaApi api, FakePasskeyClient passkeys, StubGate gate})> pump(
  WidgetTester tester, {
  required Widget screen,
  MfaStatus? statusValue,
  FakeMfaApi? api,
  SessionGate gate = const GateReady(),
  SessionGate? after,
}) async {
  tester.view.physicalSize = const Size(1200, 2600);
  tester.view.devicePixelRatio = 1.5;
  addTearDown(tester.view.reset);
  final fakeApi = api ?? FakeMfaApi(statusValue: statusValue);
  fakeApi.statusValue ??= statusValue;
  final passkeys = FakePasskeyClient(result: {'id': 'cred'}, created: {'id': 'new'});
  final stub = StubGate(gate, afterRefresh: after);
  await tester.pumpWidget(const SizedBox());
  await tester.pumpWidget(host(
    screen,
    auth: FakeAuthService(),
    extra: [
      mfaApiProvider.overrideWithValue(fakeApi),
      passkeyClientProvider.overrideWithValue(passkeys),
      sessionGateProvider.overrideWith(() => stub),
    ],
  ));
  await tester.pumpAndSettle();
  return (api: fakeApi, passkeys: passkeys, gate: stub);
}

Future<void> openMenuFor(WidgetTester tester, String nickname) async {
  await tester.tap(find.byTooltip('Options for $nickname'));
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  testWidgets('lists passkeys, the authenticator app and backup codes; shows the 24-hour wait', (tester) async {
    await pump(
      tester,
      screen: SecurityScreen(now: () => now),
      statusValue: statusOf(passkeys: [passkeyJson, secondPasskey], totp: true, codes: 2),
    );
    expect(find.text('iPhone'), findsOneWidget);
    expect(find.text('Synced with your password manager'), findsOneWidget);
    expect(find.text('YubiKey'), findsOneWidget);
    expect(find.text('On one device or security key'), findsOneWidget);
    expect(find.textContaining('Can approve changes from'), findsOneWidget);
    expect(find.text('On'), findsOneWidget);
    expect(find.text('2 codes left'), findsOneWidget);
    expect(find.text('Running low. Make a new set.'), findsOneWidget);
  });

  testWidgets('the only method cannot be removed, and no confirm is asked', (tester) async {
    final r = await pump(tester, screen: SecurityScreen(now: () => now), statusValue: statusOf());
    await openMenuFor(tester, 'iPhone');
    await tester.tap(find.text('Remove'));
    await tester.pumpAndSettle();
    expect(find.text('Add another way first'), findsOneWidget);
    expect(r.api.calls, ['status']);
  });

  testWidgets('remove a passkey: are you sure → confirm with passkey → removed with that grant', (tester) async {
    final r = await pump(tester, screen: SecurityScreen(now: () => now), statusValue: statusOf(totp: true));
    await openMenuFor(tester, 'iPhone');
    await tester.tap(find.text('Remove'));
    await tester.pumpAndSettle();
    expect(find.text('Remove “iPhone”?'), findsOneWidget);
    await tester.tap(find.widgetWithText(TextButton, 'Remove'));
    await tester.pumpAndSettle();

    expect(find.text('Confirm it’s you'), findsOneWidget);
    expect(find.text('Remove the passkey “iPhone”.'), findsOneWidget);
    await tester.tap(find.text('Use passkey'));
    await tester.pumpAndSettle();

    expect(r.api.calls, [
      'status',
      'stepUpOptions:factor_remove:passkey:11111111-1111-4111-8111-111111111111',
      'stepUpPasskey:33333333-3333-4333-8333-333333333333',
      'removePasskey:11111111-1111-4111-8111-111111111111',
      'status',
    ]);
    expect(r.api.grants['removePasskey'], 'grant-passkey');
    expect(find.textContaining('signed out on your other devices'), findsOneWidget);
  });

  testWidgets('closing the confirm sheet changes nothing', (tester) async {
    final r = await pump(tester, screen: SecurityScreen(now: () => now), statusValue: statusOf(totp: true));
    await tester.tap(find.text('Turn off'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Turn off'));
    await tester.pumpAndSettle();
    expect(find.text('Turn off the authenticator app.'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(r.api.calls, ['status']);
  });

  testWidgets('add a passkey: name → confirm with authenticator code → made → waits 24 hours', (tester) async {
    final api = FakeMfaApi(statusValue: statusOf(totp: true), usableFrom: DateTime.utc(2026, 10, 29, 14));
    final r = await pump(tester, screen: SecurityScreen(now: () => now), api: api);
    await tester.tap(find.text('Add a passkey'));
    await tester.pumpAndSettle();
    expect(find.text('Name this passkey'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'Work phone');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Use authenticator app code'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), '12345');
    await tester.tap(find.text('Confirm'));
    await tester.pump();
    expect(find.text('Enter the 6-digit code from your authenticator app.'), findsOneWidget);
    await tester.enterText(find.byType(TextField), '123456');
    await tester.tap(find.text('Confirm'));
    await tester.pumpAndSettle();

    expect(r.api.grants['registerOptions'], 'grant-totp');
    expect(r.passkeys.createCalls, hasLength(1));
    expect(r.api.calls, contains('registerVerify:Work phone'));
    expect(find.textContaining('it can approve changes'), findsOneWidget);
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    expect(r.api.calls.last, 'status');
  });

  testWidgets('a phone that cannot make a passkey says what to do', (tester) async {
    final r = await pump(tester, screen: SecurityScreen(now: () => now), statusValue: statusOf());
    r.passkeys.failure = PasskeyFailure.unsupported;
    await tester.tap(find.text('Add a passkey'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    // The step-up sheet itself uses the passkey client too, so confirm with a backup code.
    await tester.tap(find.text('Use a backup code'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'abcd-efgh');
    await tester.tap(find.text('Confirm'));
    await tester.pumpAndSettle();
    expect(r.api.grants['registerOptions'], 'grant-backup');
    expect(find.textContaining('Set a screen lock'), findsOneWidget);
    expect(r.api.calls, isNot(contains(startsWith('registerVerify'))));
  });

  testWidgets('new backup codes: shown once, Done only after "I’ve saved"', (tester) async {
    final api = FakeMfaApi(statusValue: statusOf(), backupCodes: ['1111-2222', '3333-4444']);
    final r = await pump(tester, screen: SecurityScreen(now: () => now), api: api);
    await tester.tap(find.text('Make new backup codes'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Make new codes'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Use passkey'));
    await tester.pumpAndSettle();

    expect(r.api.grants['regenerate'], 'grant-passkey');
    expect(find.text('Save your backup codes'), findsOneWidget);
    expect(find.text('1111-2222'), findsOneWidget);
    final done = find.widgetWithText(InkWell, 'Done');
    expect(tester.widget<InkWell>(done).onTap, isNull);
    await tester.tap(find.text('I’ve saved these codes somewhere safe'));
    await tester.pump();
    expect(tester.widget<InkWell>(done).onTap, isNotNull);
    await tester.tap(done);
    await tester.pumpAndSettle();
    expect(find.text('Security'), findsOneWidget);
  });

  testWidgets('set-up required: first passkey needs no confirm, shows codes, then the gate moves on', (tester) async {
    final first = MfaStatus.fromJson(statusJson(enrolmentRequired: true));
    final api = FakeMfaApi(backupCodes: ['1111-2222']);
    final r = await pump(
      tester,
      screen: const SetupRequiredScreen(),
      api: api,
      gate: GateSetupRequired(first),
    );
    expect(find.text('Set it up on the website'), findsNothing);
    // The button's spinner keeps running under the codes page, so pump fixed frames.
    Future<void> frames() async {
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
    }

    await tester.tap(find.text('Add a passkey'));
    await frames();
    await tester.tap(find.text('Continue'));
    await frames();

    expect(r.api.calls.first, 'registerOptions');
    expect(r.api.grants['registerOptions'], isNull);
    expect(find.text('Save your backup codes'), findsOneWidget);
    expect(r.gate.refreshes, 0);
    await tester.tap(find.text('I’ve saved these codes somewhere safe'));
    await tester.pump();
    await tester.tap(find.text('Done'));
    await frames();
    expect(r.gate.refreshes, 1);
  });

  testWidgets('authenticator set-up: key grouped, opens the app, checks a code', (tester) async {
    final opened = <Uri>[];
    final r = await pump(
      tester,
      screen: AuthenticatorSetupScreen(stepUpToken: 'g', launcher: (u) async {
        opened.add(u);
        return true;
      }),
    );
    expect(r.api.grants['totpSetup'], 'g');
    expect(find.text('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP'), findsOneWidget);
    await tester.tap(find.text('Open in authenticator app'));
    await tester.pump();
    expect(opened.single.scheme, 'otpauth');

    await tester.tap(find.text('Turn on'));
    await tester.pump();
    expect(find.text('Enter the 6-digit code from your authenticator app.'), findsOneWidget);
    await tester.enterText(find.byType(TextField), '654321');
    await tester.tap(find.text('Turn on'));
    await tester.pumpAndSettle();
    expect(r.api.calls, ['totpSetup', 'totpConfirm:654321']);
  });

  testWidgets('lays out at 200% text size', (tester) async {
    tester.platformDispatcher.textScaleFactorTestValue = 2.0;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await pump(
      tester,
      screen: SecurityScreen(now: () => now),
      statusValue: statusOf(passkeys: [passkeyJson, secondPasskey], totp: true, codes: 2),
    );
    expect(tester.takeException(), isNull);
    expect(find.text('Passkeys'), findsOneWidget);
  });
}
