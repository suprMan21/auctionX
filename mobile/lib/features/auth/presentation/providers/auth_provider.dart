import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart' hide AuthState;
import '../../data/datasources/supabase_auth_datasource.dart';
import '../../data/repositories/auth_repository_impl.dart';
import '../../domain/repositories/auth_repository.dart';
import 'auth_state.dart';

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  final datasource = SupabaseAuthDatasource(Supabase.instance.client);
  return AuthRepositoryImpl(datasource);
});

final authNotifierProvider =
    StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(ref.watch(authRepositoryProvider));
});

class AuthNotifier extends StateNotifier<AuthState> {
  final AuthRepository _repository;
  StreamSubscription<void>? _authSub;

  AuthNotifier(this._repository) : super(const AuthState.initial()) {
    _init();
  }

  Future<void> _init() async {
    final user = await _repository.getCurrentUser();
    if (user != null) {
      state = AuthState.authenticated(user);
    } else {
      state = const AuthState.unauthenticated();
    }

    _authSub = _repository.authStateChanges().listen((user) {
      if (user != null) {
        state = AuthState.authenticated(user);
      } else {
        state = const AuthState.unauthenticated();
      }
    });
  }

  Future<void> signIn({required String email, required String password}) async {
    state = const AuthState.loading();
    final result = await _repository.signIn(email: email, password: password);
    state = result.fold(
      (failure) => AuthState.error(failure.message),
      (user) => AuthState.authenticated(user),
    );
  }

  Future<void> signUp({required String email, required String password}) async {
    state = const AuthState.loading();
    final result = await _repository.signUp(email: email, password: password);
    state = result.fold(
      (failure) => AuthState.error(failure.message),
      (user) => AuthState.authenticated(user),
    );
  }

  Future<void> signOut() async {
    state = const AuthState.loading();
    final result = await _repository.signOut();
    state = result.fold(
      (failure) => AuthState.error(failure.message),
      (_) => const AuthState.unauthenticated(),
    );
  }

  Future<void> resetPassword({required String email}) async {
    state = const AuthState.loading();
    final result = await _repository.resetPassword(email: email);
    state = result.fold(
      (failure) => AuthState.error(failure.message),
      (_) => const AuthState.unauthenticated(),
    );
  }

  @override
  void dispose() {
    _authSub?.cancel();
    super.dispose();
  }
}
