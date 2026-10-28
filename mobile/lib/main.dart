import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'app.dart';
import 'app_providers.dart';
import 'core/config/app_config.dart';
import 'core/network/api_client.dart';
import 'core/storage/secure_session_storage.dart';
import 'features/auth/data/auth_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  GoogleFonts.config.allowRuntimeFetching = false;

  final config = AppConfig.fromEnvironment();
  final info = await PackageInfo.fromPlatform();
  final client = ClientInfo(
    version: info.version,
    build: info.buildNumber,
    platform: Platform.isIOS ? 'ios' : 'android',
  );

  final store = PlatformSecureStore();
  await FirstLaunchCleanup(store).run();

  await Supabase.initialize(
    url: config.supabaseUrl,
    publishableKey: config.supabasePublishableKey,
    authOptions: FlutterAuthClientOptions(
      localStorage: SecureSessionStorage(store),
      pkceAsyncStorage: SecurePkceStorage(store),
    ),
  );

  runApp(
    ProviderScope(
      overrides: [
        appConfigProvider.overrideWithValue(config),
        clientInfoProvider.overrideWithValue(client),
        authServiceProvider.overrideWithValue(AuthService(Supabase.instance.client.auth)),
      ],
      child: const AuthenticMaterialsApp(),
    ),
  );
}
