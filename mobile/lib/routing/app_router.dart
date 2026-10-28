import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app_providers.dart';
import '../features/app_update/update_gate.dart';
import '../features/app_update/update_required_screen.dart';
import '../features/auth/data/auth_service.dart';
import '../features/auth/presentation/screens/sign_in_screen.dart';
import '../features/auth/presentation/screens/splash_screen.dart';
import '../features/home/home_screen.dart';
import '../features/mfa/presentation/gate_screens.dart';
import '../features/mfa/presentation/second_factor_screen.dart';
import '../features/mfa/session_gate.dart';
import '../features/security/security_screen.dart';
import 'route_names.dart';

/// Where the app must be, given the gates, or null to stay put.
///
/// Order: update required → still loading → signed out → second step →
/// method set-up → not a Creator → home.
String? gateRedirect({
  required UpdateState update,
  required AuthStatus auth,
  required String location,
  SessionGate session = const GateReady(),
}) {
  String? to(String target) => location == target ? null : target;

  if (update is UpdateRequired) return to(RouteNames.update);
  if (update is UpdateChecking || auth is AuthUnknown) return to(RouteNames.splash);
  if (auth is SignedOut) return to(RouteNames.signIn);

  switch (session) {
    case GateIdle() || GateLoading():
      return to(RouteNames.splash);
    case GateError():
      return to(RouteNames.problem);
    case GateSecondFactor():
      return to(RouteNames.secondFactor);
    case GateSetupRequired():
      return to(RouteNames.setupRequired);
    case GateNotCreator():
      return to(RouteNames.creatorsOnly);
    case GateReady():
      // Fully signed in: the gate screens are no longer places to be.
      return _gateScreens.contains(location) ? RouteNames.home : null;
  }
}

const _gateScreens = {
  RouteNames.splash,
  RouteNames.signIn,
  RouteNames.update,
  RouteNames.secondFactor,
  RouteNames.setupRequired,
  RouteNames.creatorsOnly,
  RouteNames.problem,
};

/// Re-runs the redirect whenever a gate changes.
class _GateRefresh extends ChangeNotifier {
  _GateRefresh(Ref ref) {
    ref.listen(updateGateProvider, (_, _) => notifyListeners());
    ref.listen(authControllerProvider, (_, _) => notifyListeners());
    ref.listen(sessionGateProvider, (_, _) => notifyListeners());
  }
}

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = _GateRefresh(ref);
  ref.onDispose(refresh.dispose);

  final router = GoRouter(
    initialLocation: RouteNames.splash,
    refreshListenable: refresh,
    redirect: (context, state) => gateRedirect(
      update: ref.read(updateGateProvider),
      auth: ref.read(authControllerProvider),
      location: state.uri.path,
      session: ref.read(sessionGateProvider),
    ),
    // Unknown paths (including any deep link the app doesn't handle) go home
    // through the gates; incoming links are read by the link listener instead.
    errorBuilder: (context, state) => const SplashScreen(),
    routes: [
      GoRoute(path: RouteNames.splash, builder: (_, _) => const SplashScreen()),
      GoRoute(path: RouteNames.update, builder: (_, _) => const UpdateRequiredScreen()),
      GoRoute(path: RouteNames.signIn, builder: (_, _) => const SignInScreen()),
      GoRoute(path: RouteNames.home, builder: (_, _) => const HomeScreen()),
      GoRoute(path: RouteNames.secondFactor, builder: (_, _) => const SecondFactorScreen()),
      GoRoute(path: RouteNames.setupRequired, builder: (_, _) => const SetupRequiredScreen()),
      GoRoute(path: RouteNames.creatorsOnly, builder: (_, _) => const CreatorsOnlyScreen()),
      GoRoute(path: RouteNames.problem, builder: (_, _) => const SessionProblemScreen()),
      // Fully signed in only: the redirect sends every other state elsewhere.
      GoRoute(path: RouteNames.security, builder: (_, _) => const SecurityScreen()),
    ],
  );
  ref.onDispose(router.dispose);
  return router;
});
