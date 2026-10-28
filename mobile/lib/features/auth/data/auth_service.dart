import 'package:supabase_flutter/supabase_flutter.dart';

/// Who is signed in, as far as the app needs to know.
class SignedInUser {
  const SignedInUser({required this.id, required this.email});
  final String id;
  final String email;
}

sealed class AuthStatus {
  const AuthStatus();
}

class AuthUnknown extends AuthStatus {
  const AuthUnknown();
}

class SignedOut extends AuthStatus {
  const SignedOut();
}

class SignedIn extends AuthStatus {
  const SignedIn(this.user);
  final SignedInUser user;
}

/// A sign-in failure in plain words.
class SignInFailure implements Exception {
  const SignInFailure(this.message);
  final String message;
  @override
  String toString() => message;
}

/// Password sign-in through Supabase. The second step (S-MOB1 phase B) runs
/// against our backend after this.
class AuthService {
  AuthService(this._auth);

  final GoTrueClient _auth;

  AuthStatus get current {
    final user = _auth.currentSession?.user;
    return user == null ? const SignedOut() : SignedIn(_map(user));
  }

  Stream<AuthStatus> get changes => _auth.onAuthStateChange.map((event) {
        final user = event.session?.user;
        return user == null ? const SignedOut() : SignedIn(_map(user));
      });

  Future<void> signIn({required String email, required String password}) async {
    try {
      await _auth.signInWithPassword(email: email.trim(), password: password);
    } on AuthException catch (e) {
      throw SignInFailure(signInMessage(e.message, e.code));
    } catch (_) {
      throw const SignInFailure(
          "Can't reach Authentic Materials. Check your connection and try again.");
    }
  }

  Future<void> signOut() async {
    try {
      await _auth.signOut();
    } catch (_) {
      // Signed out locally even when the server can't be reached.
      await _auth.signOut(scope: SignOutScope.local);
    }
  }

  static SignedInUser _map(User user) => SignedInUser(id: user.id, email: user.email ?? '');

  /// GoTrue's messages are developer text; map the ones people hit.
  static String signInMessage(String message, String? code) {
    final m = message.toLowerCase();
    final c = code ?? '';
    if (c == 'invalid_credentials' || m.contains('invalid login credentials')) {
      return "That email and password don't match. Check them and try again.";
    }
    if (c == 'email_not_confirmed' || m.contains('email not confirmed')) {
      return 'Confirm your email first. Check your inbox for the link we sent.';
    }
    if (c == 'user_banned' || m.contains('banned')) {
      return 'This account is paused. Email hello@authentic-materials.com for help.';
    }
    if (c == 'over_request_rate_limit' || m.contains('rate limit') || m.contains('too many')) {
      return 'Too many tries. Wait a minute, then try again.';
    }
    return "We couldn't sign you in. Please try again.";
  }
}
