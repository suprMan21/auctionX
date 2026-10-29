import 'package:authentic_materials/app_providers.dart';
import 'package:authentic_materials/core/config/app_config.dart';
import 'package:authentic_materials/core/network/api_client.dart';
import 'package:authentic_materials/routing/app_router.dart';
import 'package:authentic_materials/routing/route_names.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import '../features/auth_screens_test.dart' show FakeAuthService;

AppConfig configFor(String env) => AppConfig.fromMap({
  'ENV': env,
  'SUPABASE_URL': 'https://abc.supabase.co',
  'SUPABASE_PUBLISHABLE_KEY': 'k',
  'API_BASE_URL': 'https://api.example.com/api/v1',
  'WEB_BASE_URL': 'https://web.example.com',
  'RP_ID': 'web.example.com',
});

List<String> pathsFor(String env) {
  final container = ProviderContainer(
    overrides: [
      appConfigProvider.overrideWithValue(configFor(env)),
      clientInfoProvider.overrideWithValue(const ClientInfo(version: '0.1.0', build: '1', platform: 'ios')),
      authServiceProvider.overrideWithValue(FakeAuthService()),
    ],
  );
  addTearDown(container.dispose);
  return [for (final r in container.read(routerProvider).configuration.routes) (r as GoRoute).path];
}

void main() {
  test('the seal preview exists in test builds only', () {
    expect(pathsFor('staging'), contains(RouteNames.sealPreview));
    expect(pathsFor('prod'), isNot(contains(RouteNames.sealPreview)));
  });

  test('the read check exists in test builds only; sealing exists in both', () {
    expect(pathsFor('staging'), contains(RouteNames.readCheck));
    expect(pathsFor('prod'), isNot(contains(RouteNames.readCheck)));
    for (final env in ['staging', 'prod']) {
      expect(pathsFor(env), containsAll([RouteNames.sealPrep, RouteNames.sealTake, RouteNames.sealResult]));
    }
  });

  test('take and result opened without their arguments (a link) go home', () {
    final container = ProviderContainer(
      overrides: [
        appConfigProvider.overrideWithValue(configFor('prod')),
        clientInfoProvider.overrideWithValue(const ClientInfo(version: '0.1.0', build: '1', platform: 'ios')),
        authServiceProvider.overrideWithValue(FakeAuthService()),
      ],
    );
    addTearDown(container.dispose);
    final routes = container.read(routerProvider).configuration.routes.cast<GoRoute>();
    for (final path in [RouteNames.sealTake, RouteNames.sealResult]) {
      final route = routes.firstWhere((r) => r.path == path);
      expect(route.redirect, isNotNull, reason: path);
    }
  });
}
