import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../account/data/account_type_reader.dart';
import '../auth/data/auth_service.dart';
import 'data/mfa_models.dart';

/// What a signed-in person still has to do before the app opens.
sealed class SessionGate {
  const SessionGate();
}

/// Not signed in (the auth gate handles that).
class GateIdle extends SessionGate {
  const GateIdle();
}

class GateLoading extends SessionGate {
  const GateLoading();
}

/// Status or account type could not be loaded.
class GateError extends SessionGate {
  const GateError(this.message);
  final String message;
}

/// Has a method; this sign-in hasn't used it yet.
class GateSecondFactor extends SessionGate {
  const GateSecondFactor(this.status);
  final MfaStatus status;
}

/// Must add a method before using the app.
class GateSetupRequired extends SessionGate {
  const GateSetupRequired(this.status);
  final MfaStatus status;
}

/// Signed in properly, but the app is for Creators.
class GateNotCreator extends SessionGate {
  const GateNotCreator();
}

class GateReady extends SessionGate {
  const GateReady();
}

/// Order (plan S-MOB1 phase B): second step → method set-up → Creator.
/// The second step comes first so an account's type is only acted on after
/// the person has fully signed in.
SessionGate decideGate(MfaStatus status, AccountType type) {
  if (status.hasFactor && !status.sessionVerified) return GateSecondFactor(status);
  if (!status.hasFactor && status.enrolmentRequired) return GateSetupRequired(status);
  if (type != AccountType.creator) return const GateNotCreator();
  return const GateReady();
}

typedef StatusLoader = Future<MfaStatus> Function();

/// Loads the gate whenever a different person signs in, and on [refresh].
/// A token refresh for the same person does not reload (no flash of the
/// splash screen every hour).
class SessionGateController extends Notifier<SessionGate> {
  SessionGateController({
    required this.auth,
    required this.loadStatus,
    required this.accountTypes,
    required this.signOut,
  });

  final ProviderListenable<AuthStatus> auth;
  final StatusLoader Function(Ref ref) loadStatus;
  final AccountTypeReader Function(Ref ref) accountTypes;
  final Future<void> Function(Ref ref) signOut;

  String? _userId;
  int _generation = 0;

  @override
  SessionGate build() {
    ref.listen<AuthStatus>(auth, (_, next) => _onAuth(next));
    final current = ref.read(auth);
    if (current is SignedIn) {
      _userId = current.user.id;
      Future.microtask(refresh);
      return const GateLoading();
    }
    _userId = null;
    return const GateIdle();
  }

  void _onAuth(AuthStatus next) {
    if (next is SignedIn) {
      if (next.user.id == _userId) return;
      _userId = next.user.id;
      state = const GateLoading();
      refresh();
    } else {
      _userId = null;
      _generation++;
      state = const GateIdle();
    }
  }

  /// Reloads. [quiet] keeps the current screen up while loading (after a
  /// second step, or "Check again").
  Future<void> refresh({bool quiet = false}) async {
    final userId = _userId;
    if (userId == null) return;
    final generation = ++_generation;
    if (!quiet) state = const GateLoading();
    try {
      final results = await Future.wait<Object>([
        loadStatus(ref)(),
        accountTypes(ref).read(userId),
      ]);
      if (generation != _generation) return;
      state = decideGate(results[0] as MfaStatus, results[1] as AccountType);
    } on ApiException catch (e) {
      if (generation != _generation) return;
      if (e.status == 401) {
        // The session is gone on the server: start again from sign-in.
        await signOut(ref);
        return;
      }
      state = GateError(e.updateRequired ? 'This version of the app needs an update.' : e.message);
    } catch (_) {
      if (generation != _generation) return;
      state = const GateError('Something went wrong. Please try again.');
    }
  }
}
