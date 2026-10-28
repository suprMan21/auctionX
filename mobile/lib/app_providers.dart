import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'core/config/app_config.dart';
import 'core/links/web_links.dart';
import 'core/network/api_client.dart';
import 'features/app_update/update_gate.dart';
import 'features/account/data/account_type_reader.dart';
import 'features/auth/data/auth_service.dart';
import 'features/mfa/data/corbado_passkey_client.dart';
import 'features/mfa/data/mfa_api.dart';
import 'features/mfa/data/passkey_client.dart';
import 'features/mfa/session_gate.dart';

/// Overridden in main() with the values compiled into this build.
final appConfigProvider = Provider<AppConfig>((_) => throw UnimplementedError('appConfigProvider'));

/// Overridden in main() with the installed version and platform.
final clientInfoProvider = Provider<ClientInfo>((_) => throw UnimplementedError('clientInfoProvider'));

/// Overridden in main() (and in tests).
final authServiceProvider = Provider<AuthService>((_) => throw UnimplementedError('authServiceProvider'));

final webLinksProvider = Provider<WebLinks>((ref) => WebLinks(ref.watch(appConfigProvider).webBaseUrl));

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(
    baseUrl: ref.watch(appConfigProvider).apiBaseUrl,
    client: ref.watch(clientInfoProvider),
    accessToken: () => Supabase.instance.client.auth.currentSession?.accessToken,
    onUpdateRequired: () => ref.read(updateGateProvider.notifier).markRequired(),
  );
});

/// Minimum-version state.
class UpdateGate extends Notifier<UpdateState> {
  @override
  UpdateState build() => const UpdateChecking();

  Future<void> check() async {
    final result = await checkForUpdate(ref.read(apiClientProvider), ref.read(clientInfoProvider));
    // A 426 seen meanwhile wins over an OK from the start-up check.
    if (state is! UpdateRequired) state = result;
  }

  void markRequired() {
    if (state is! UpdateRequired) state = const UpdateRequired();
  }
}

final updateGateProvider = NotifierProvider<UpdateGate, UpdateState>(UpdateGate.new);

/// Signed in or not, following Supabase.
class AuthController extends Notifier<AuthStatus> {
  StreamSubscription<AuthStatus>? _sub;

  @override
  AuthStatus build() {
    final service = ref.watch(authServiceProvider);
    _sub = service.changes.listen((status) => state = status);
    ref.onDispose(() => _sub?.cancel());
    return service.current;
  }

  Future<void> signIn(String email, String password) =>
      ref.read(authServiceProvider).signIn(email: email, password: password);

  Future<void> signOut() => ref.read(authServiceProvider).signOut();
}

final authControllerProvider = NotifierProvider<AuthController, AuthStatus>(AuthController.new);

/// Email to prefill on the sign-in screen (from the website's "Open the app" link).
final emailHintProvider = StateProvider<String?>((_) => null);

final mfaApiProvider = Provider<MfaApi>((ref) => MfaApi(ref.watch(apiClientProvider)));

/// The OS passkey sheet, behind our own interface (tests use a fake).
final passkeyClientProvider = Provider<PasskeyClient>((_) => CorbadoPasskeyClient());

final accountTypeReaderProvider =
    Provider<AccountTypeReader>((_) => SupabaseAccountTypeReader(Supabase.instance.client));

/// Second step, method set-up and Creator check for the signed-in person.
final sessionGateProvider = NotifierProvider<SessionGateController, SessionGate>(
  () => SessionGateController(
    auth: authControllerProvider,
    loadStatus: (ref) => ref.read(mfaApiProvider).status,
    accountTypes: (ref) => ref.read(accountTypeReaderProvider),
    signOut: (ref) => ref.read(authControllerProvider.notifier).signOut(),
  ),
);
