import 'package:supabase_flutter/supabase_flutter.dart';
import '../../domain/entities/user_entity.dart';

class SupabaseAuthDatasource {
  final SupabaseClient _client;

  SupabaseAuthDatasource(this._client);

  Future<UserEntity> signIn({
    required String email,
    required String password,
  }) async {
    final response = await _client.auth.signInWithPassword(
      email: email,
      password: password,
    );
    return _mapUser(response.user!);
  }

  Future<UserEntity> signUp({
    required String email,
    required String password,
  }) async {
    final response = await _client.auth.signUp(
      email: email,
      password: password,
    );
    return _mapUser(response.user!);
  }

  Future<void> signOut() async {
    await _client.auth.signOut();
  }

  Future<void> resetPassword({required String email}) async {
    await _client.auth.resetPasswordForEmail(email);
  }

  Stream<UserEntity?> authStateChanges() {
    return _client.auth.onAuthStateChange.map((event) {
      final user = event.session?.user;
      return user != null ? _mapUser(user) : null;
    });
  }

  Future<UserEntity?> getCurrentUser() async {
    final session = _client.auth.currentSession;
    if (session == null) return null;
    return _mapUser(session.user);
  }

  UserEntity _mapUser(User user) {
    return UserEntity(
      id: user.id,
      email: user.email ?? '',
      displayName: user.userMetadata?['display_name'] as String?,
      avatarUrl: user.userMetadata?['avatar_url'] as String?,
    );
  }
}
