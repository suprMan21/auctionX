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
import 'route_names.dart';

/// Where the app must be, given the gates, or null to stay put.
///
/// Order: update required → still loading → signed out → signed in.
/// Phase B adds: second factor pending, method set-up required, not a Creator.
String? gateRedirect({required UpdateState update, required AuthStatus auth, required String location}) {
  String? to(String target) => location == target ? null : target;

  if (update is UpdateRequired) return to(RouteNames.update);
  if (update is UpdateChecking || auth is AuthUnknown) return to(RouteNames.splash);
  if (auth is SignedOut) return to(RouteNames.signIn);
  // Signed in: the auth screens and splash are no longer places to be.
  if (location == RouteNames.signIn || location == RouteNames.splash || location == RouteNames.update) {
    return RouteNames.home;
  }
  return null;
}

/// Re-runs the redirect whenever a gate changes.
class _GateRefresh extends ChangeNotifier {
  _GateRefresh(Ref ref) {
    ref.listen(updateGateProvider, (_, _) => notifyListeners());
    ref.listen(authControllerProvider, (_, _) => notifyListeners());
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
    ),
    // Unknown paths (including any deep link the app doesn't handle) go home
    // through the gates; incoming links are read by the link listener instead.
    errorBuilder: (context, state) => const SplashScreen(),
    routes: [
      GoRoute(path: RouteNames.splash, builder: (_, _) => const SplashScreen()),
      GoRoute(path: RouteNames.update, builder: (_, _) => const UpdateRequiredScreen()),
      GoRoute(path: RouteNames.signIn, builder: (_, _) => const SignInScreen()),
      GoRoute(path: RouteNames.home, builder: (_, _) => const HomeScreen()),
    ],
  );
  ref.onDispose(router.dispose);
  return router;
});
