import 'dart:async';

import 'package:authentic_materials/app_providers.dart';
import 'package:authentic_materials/core/config/app_config.dart';
import 'package:authentic_materials/core/network/api_client.dart';
import 'package:authentic_materials/features/app_update/update_gate.dart';
import 'package:authentic_materials/features/app_update/update_required_screen.dart';
import 'package:authentic_materials/features/auth/data/auth_service.dart';
import 'package:authentic_materials/features/auth/presentation/screens/sign_in_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';

class FakeAuthService implements AuthService {
  FakeAuthService({this.failWith});
  final String? failWith;
  final _changes = StreamController<AuthStatus>.broadcast();
  final calls = <String>[];

  @override
  AuthStatus get current => const SignedOut();
  @override
  Stream<AuthStatus> get changes => _changes.stream;
  @override
  Future<void> signIn({required String email, required String password}) async {
    calls.add(email);
    if (failWith != null) throw SignInFailure(failWith!);
    _changes.add(SignedIn(SignedInUser(id: 'u', email: email)));
  }

  @override
  Future<void> signOut() async => _changes.add(const SignedOut());
}

final config = AppConfig.fromMap({
  'ENV': 'staging',
  'SUPABASE_URL': 'https://abc.supabase.co',
  'SUPABASE_PUBLISHABLE_KEY': 'k',
  'API_BASE_URL': 'https://api.example.com/api/v1',
  'WEB_BASE_URL': 'https://web.example.com',
  'RP_ID': 'web.example.com',
});

Widget host(Widget child, {required AuthService auth, List<Override> extra = const []}) => ProviderScope(
      overrides: [
        appConfigProvider.overrideWithValue(config),
        clientInfoProvider.overrideWithValue(const ClientInfo(version: '0.1.0', build: '1', platform: 'ios')),
        authServiceProvider.overrideWithValue(auth),
        ...extra,
      ],
      child: MaterialApp(home: child),
    );

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  testWidgets('sign in: labelled fields, empty submit explains itself', (tester) async {
    await tester.pumpWidget(host(const SignInScreen(), auth: FakeAuthService()));
    expect(find.widgetWithText(TextField, 'Email'), findsOneWidget);
    expect(find.widgetWithText(TextField, 'Password'), findsOneWidget);
    expect(find.text('Create an account on our website'), findsOneWidget);
    expect(find.text('Forgot password?'), findsOneWidget);
    expect(find.byTooltip('Show password'), findsOneWidget);

    await tester.tap(find.text('Sign in').last);
    await tester.pump();
    expect(find.text('Enter your email and password.'), findsOneWidget);
  });

  testWidgets('sign in: a failure shows the plain message', (tester) async {
    final auth = FakeAuthService(failWith: "That email and password don't match. Check them and try again.");
    await tester.pumpWidget(host(const SignInScreen(), auth: auth));
    await tester.enterText(find.widgetWithText(TextField, 'Email'), ' a@b.co ');
    await tester.enterText(find.widgetWithText(TextField, 'Password'), 'pw');
    await tester.tap(find.text('Sign in').last);
    await tester.pumpAndSettle();
    expect(auth.calls, ['a@b.co']);
    expect(find.textContaining("don't match"), findsOneWidget);
  });

  testWidgets('sign in: an email hint from the website prefills the field', (tester) async {
    await tester.pumpWidget(host(
      const SignInScreen(),
      auth: FakeAuthService(),
      extra: [emailHintProvider.overrideWith((_) => 'hint@b.co')],
    ));
    expect(find.text('hint@b.co'), findsOneWidget);
  });

  testWidgets('sign in: survives 200% text size without overflow', (tester) async {
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MediaQuery(
      data: const MediaQueryData(textScaler: TextScaler.linear(2)),
      child: host(const SignInScreen(), auth: FakeAuthService()),
    ));
    expect(tester.takeException(), isNull);
  });

  testWidgets('update screen: link button only when the server gave a link', (tester) async {
    final gate = UpdateGate();
    await tester.pumpWidget(host(
      const UpdateRequiredScreen(),
      auth: FakeAuthService(),
      extra: [updateGateProvider.overrideWith(() => gate)],
    ));
    gate.state = UpdateRequired(updateUrl: Uri.parse('https://apps.apple.com/app/id1'));
    await tester.pump();
    expect(find.text('Update the app'), findsOneWidget);
    expect(find.text('Update now'), findsOneWidget);

    gate.state = const UpdateRequired();
    await tester.pump();
    expect(find.text('Update now'), findsNothing);
    expect(find.textContaining('App Store or Google Play'), findsOneWidget);
  });

  test('GoTrue messages map to plain words', () {
    expect(AuthService.signInMessage('Invalid login credentials', null), contains("don't match"));
    expect(AuthService.signInMessage('Email not confirmed', null), contains('Confirm your email'));
    expect(AuthService.signInMessage('User is banned', 'user_banned'), contains('paused'));
    expect(AuthService.signInMessage('weird internal thing', null), "We couldn't sign you in. Please try again.");
  });
}
