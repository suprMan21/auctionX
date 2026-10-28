import 'package:authentic_materials/features/app_update/update_gate.dart';
import 'package:authentic_materials/features/auth/data/auth_service.dart';
import 'package:authentic_materials/features/mfa/session_gate.dart';
import 'package:authentic_materials/routing/app_router.dart';
import 'package:authentic_materials/routing/route_names.dart';
import 'package:flutter_test/flutter_test.dart';

import '../features/mfa/mfa_fakes.dart';

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

  group('signed in: the session gate', () {
    String? at(SessionGate g, String loc) =>
        gateRedirect(update: const UpdateOk(), auth: user, location: loc, session: g);

    test('loading → splash, error → problem', () {
      expect(at(const GateLoading(), RouteNames.home), RouteNames.splash);
      expect(at(const GateIdle(), RouteNames.signIn), RouteNames.splash);
      expect(at(const GateError('x'), RouteNames.home), RouteNames.problem);
    });

    test('each gate pins its screen; home is unreachable until ready', () {
      final cases = <SessionGate, String>{
        GateSecondFactor(status(passkey: true)): RouteNames.secondFactor,
        GateSetupRequired(status(enrol: true)): RouteNames.setupRequired,
        const GateNotCreator(): RouteNames.creatorsOnly,
      };
      cases.forEach((gate, screen) {
        for (final from in [RouteNames.home, RouteNames.splash, RouteNames.signIn, '/anything']) {
          expect(at(gate, from), screen, reason: '$gate from $from');
        }
        expect(at(gate, screen), isNull);
      });
    });

    test('ready → off every gate screen to home', () {
      for (final from in [
        RouteNames.secondFactor,
        RouteNames.setupRequired,
        RouteNames.creatorsOnly,
        RouteNames.problem,
        RouteNames.splash,
      ]) {
        expect(at(const GateReady(), from), RouteNames.home);
      }
    });

    test('update and sign-out still win over the session gate', () {
      expect(
        gateRedirect(update: const UpdateRequired(), auth: user, location: RouteNames.home, session: const GateReady()),
        RouteNames.update,
      );
      expect(
        gateRedirect(
            update: const UpdateOk(), auth: const SignedOut(), location: RouteNames.secondFactor, session: const GateNotCreator()),
        RouteNames.signIn,
      );
    });
  });
}
