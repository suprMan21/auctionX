import 'dart:async';

import 'package:authentic_materials/core/network/api_client.dart';
import 'package:authentic_materials/features/account/data/account_type_reader.dart';
import 'package:authentic_materials/features/auth/data/auth_service.dart';
import 'package:authentic_materials/features/mfa/data/mfa_models.dart';
import 'package:authentic_materials/features/mfa/session_gate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'mfa_fakes.dart';

const alice = SignedIn(SignedInUser(id: 'alice', email: 'a@b.co'));
const bob = SignedIn(SignedInUser(id: 'bob', email: 'b@b.co'));

class Harness {
  Harness({AuthStatus initial = const SignedOut()}) {
    authState = StateProvider<AuthStatus>((_) => initial);
    gate = NotifierProvider<SessionGateController, SessionGate>(() => SessionGateController(
          auth: authState,
          loadStatus: (_) => () {
            loads++;
            final next = statuses.isNotEmpty ? statuses.removeAt(0) : current;
            return next is Completer<MfaStatus> ? next.future : Future.value(next as MfaStatus);
          },
          accountTypes: (_) => types,
          signOut: (_) async => signOuts++,
        ));
    container = ProviderContainer();
    container.listen(gate, (_, _) {}, fireImmediately: true);
  }

  late final StateProvider<AuthStatus> authState;
  late final NotifierProvider<SessionGateController, SessionGate> gate;
  late final ProviderContainer container;
  final types = FakeAccountTypes(AccountType.creator);

  /// Queue of answers (MfaStatus or Completer) for the next loads.
  final statuses = <Object>[];
  Object current = status(passkey: true, verified: true);
  int loads = 0;
  int signOuts = 0;

  SessionGate get state => container.read(gate);
  void auth(AuthStatus s) => container.read(authState.notifier).state = s;
  Future<void> settle() => Future<void>.delayed(Duration.zero);
}

void main() {
  group('decideGate', () {
    test('order: second step → set-up → Creator → ready', () {
      expect(decideGate(status(passkey: true), AccountType.collector), isA<GateSecondFactor>(),
          reason: 'a method not yet used this sign-in comes first, whatever the account type');
      expect(decideGate(status(enrol: true), AccountType.creator), isA<GateSetupRequired>());
      expect(decideGate(status(passkey: true, verified: true), AccountType.collector), isA<GateNotCreator>());
      expect(decideGate(status(), AccountType.collector), isA<GateNotCreator>());
      expect(decideGate(status(passkey: true, verified: true), AccountType.creator), isA<GateReady>());
      expect(decideGate(status(), AccountType.creator), isA<GateReady>(),
          reason: 'no method and none required (flags off) → in');
    });

    test('backup codes alone still count as a method to use', () {
      expect(decideGate(status(codes: 5), AccountType.creator), isA<GateSecondFactor>());
    });
  });

  group('SessionGateController', () {
    test('signed out → idle; sign-in loads; same person again does not reload', () async {
      final h = Harness();
      expect(h.state, isA<GateIdle>());

      h.auth(alice);
      expect(h.state, isA<GateLoading>());
      await h.settle();
      expect(h.state, isA<GateReady>());
      expect(h.loads, 1);

      h.auth(alice); // token refresh
      await h.settle();
      expect(h.loads, 1);
      expect(h.state, isA<GateReady>());

      h.auth(bob);
      await h.settle();
      expect(h.loads, 2);

      h.auth(const SignedOut());
      expect(h.state, isA<GateIdle>());
    });

    test('already signed in at start → loads', () async {
      final h = Harness(initial: alice)..current = status(passkey: true);
      await h.settle();
      await h.settle();
      expect(h.state, isA<GateSecondFactor>());
    });

    test('quiet refresh keeps the screen until the answer', () async {
      final h = Harness(initial: alice)..current = status(passkey: true);
      await h.settle();
      expect(h.state, isA<GateSecondFactor>());
      final pending = Completer<MfaStatus>();
      h.statuses.add(pending);
      final done = h.container.read(h.gate.notifier).refresh(quiet: true);
      expect(h.state, isA<GateSecondFactor>());
      pending.complete(status(passkey: true, verified: true));
      await done;
      expect(h.state, isA<GateReady>());
    });

    test('a slow answer for someone who signed out is dropped', () async {
      final h = Harness();
      final pending = Completer<MfaStatus>();
      h.statuses.add(pending);
      h.auth(alice);
      h.auth(const SignedOut());
      pending.complete(status(passkey: true, verified: true));
      await h.settle();
      expect(h.state, isA<GateIdle>());
    });

    test('401 signs out; other failures show the problem screen', () async {
      final h = Harness(initial: alice);
      h.types.error = const ApiException(message: 'Please sign in again.', status: 401);
      await h.settle();
      await h.settle();
      expect(h.signOuts, 1);

      h.types.error = const ApiException(message: "Can't reach Authentic Materials.");
      await h.container.read(h.gate.notifier).refresh();
      expect(h.state, isA<GateError>());
      expect((h.state as GateError).message, "Can't reach Authentic Materials.");
    });
  });
}
