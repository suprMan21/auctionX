import 'package:authentic_materials/features/app_update/update_gate.dart';
import 'package:authentic_materials/features/auth/data/auth_service.dart';
import 'package:authentic_materials/routing/app_router.dart';
import 'package:authentic_materials/routing/route_names.dart';
import 'package:flutter_test/flutter_test.dart';

const user = SignedIn(SignedInUser(id: 'u', email: 'a@b.co'));

void main() {
  String? go(UpdateState u, AuthStatus a, String at) => gateRedirect(update: u, auth: a, location: at);

  test('update required wins over everything', () {
    for (final a in [const AuthUnknown(), const SignedOut(), user]) {
      expect(go(const UpdateRequired(), a, RouteNames.home), RouteNames.update);
      expect(go(const UpdateRequired(), a, RouteNames.update), isNull);
    }
  });

  test('still checking → splash', () {
    expect(go(const UpdateChecking(), user, RouteNames.home), RouteNames.splash);
    expect(go(const UpdateOk(), const AuthUnknown(), RouteNames.signIn), RouteNames.splash);
    expect(go(const UpdateOk(), const AuthUnknown(), RouteNames.splash), isNull);
  });

  test('signed out → sign in, from anywhere', () {
    for (final at in [RouteNames.splash, RouteNames.home, RouteNames.update, '/anything']) {
      expect(go(const UpdateOk(), const SignedOut(), at), RouteNames.signIn);
    }
    expect(go(const UpdateOk(), const SignedOut(), RouteNames.signIn), isNull);
  });

  test('signed in → home, and stays on home', () {
    for (final at in [RouteNames.splash, RouteNames.signIn, RouteNames.update]) {
      expect(go(const UpdateOk(), user, at), RouteNames.home);
    }
    expect(go(const UpdateOk(), user, RouteNames.home), isNull);
  });
}
