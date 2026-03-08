import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../features/auth/presentation/providers/auth_provider.dart';
import '../features/auth/presentation/providers/auth_state.dart';
import '../features/auth/presentation/screens/forgot_password_screen.dart';
import '../features/auth/presentation/screens/login_screen.dart';
import '../features/auth/presentation/screens/register_screen.dart';
import '../features/auth/presentation/screens/splash_screen.dart';
import '../features/browse/presentation/screens/browse_screen.dart';
import '../features/nfc/presentation/screens/nfc_placeholder_screen.dart';
import '../features/activity/presentation/screens/activity_screen.dart';
import '../features/profile/presentation/screens/profile_screen.dart';
import '../features/onboarding/presentation/screens/onboarding_screen.dart';
import '../shared/widgets/app_scaffold.dart';
import 'route_names.dart';

final _rootNavigatorKey = GlobalKey<NavigatorState>();
final _shellNavigatorKey = GlobalKey<NavigatorState>();

final routerProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authNotifierProvider);

  return GoRouter(
    navigatorKey: _rootNavigatorKey,
    initialLocation: RouteNames.splash,
    redirect: (context, state) {
      final isAuthenticated = authState.maybeWhen(
        authenticated: (_) => true,
        orElse: () => false,
      );
      final isInitialOrLoading = authState.maybeWhen(
        initial: () => true,
        loading: () => true,
        orElse: () => false,
      );

      final currentPath = state.uri.path;
      final isAuthRoute = currentPath == RouteNames.login ||
          currentPath == RouteNames.register ||
          currentPath == RouteNames.forgotPassword;
      final isSplash = currentPath == RouteNames.splash;
      final isOnboarding = currentPath == RouteNames.onboarding;

      if (isInitialOrLoading) {
        return isSplash ? null : RouteNames.splash;
      }

      if (isAuthenticated && (isAuthRoute || isSplash)) {
        return RouteNames.browse;
      }

      if (!isAuthenticated && !isAuthRoute && !isSplash && !isOnboarding) {
        return RouteNames.login;
      }

      return null;
    },
    routes: [
      GoRoute(
        path: RouteNames.splash,
        builder: (context, state) => const SplashScreen(),
      ),
      GoRoute(
        path: RouteNames.onboarding,
        builder: (context, state) => const OnboardingScreen(),
      ),
      GoRoute(
        path: RouteNames.login,
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: RouteNames.register,
        builder: (context, state) => const RegisterScreen(),
      ),
      GoRoute(
        path: RouteNames.forgotPassword,
        builder: (context, state) => const ForgotPasswordScreen(),
      ),
      ShellRoute(
        navigatorKey: _shellNavigatorKey,
        builder: (context, state, child) => AppScaffold(child: child),
        routes: [
          GoRoute(
            path: RouteNames.browse,
            pageBuilder: (context, state) => const NoTransitionPage(
              child: BrowseScreen(),
            ),
          ),
          GoRoute(
            path: RouteNames.nfc,
            pageBuilder: (context, state) => const NoTransitionPage(
              child: NfcPlaceholderScreen(),
            ),
          ),
          GoRoute(
            path: RouteNames.activity,
            pageBuilder: (context, state) => const NoTransitionPage(
              child: ActivityScreen(),
            ),
          ),
          GoRoute(
            path: RouteNames.profile,
            pageBuilder: (context, state) => const NoTransitionPage(
              child: ProfileScreen(),
            ),
          ),
        ],
      ),
    ],
  );
});
