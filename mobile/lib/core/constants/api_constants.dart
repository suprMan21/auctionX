class ApiConstants {
  ApiConstants._();

  static const supabaseUrl = 'https://pmlofthmobglcfkqjtru.supabase.co';
  // Supabase publishable (client) key. Rotated 2026-06-21 — the prior key was
  // revoked and returned 401 "Invalid API key" on login. Source of truth:
  // 1Password op://AM_Development/Supabase_Staging/newPublishKey. NOTE: this is
  // a build-time hardcode, so it goes stale on every key rotation — candidate to
  // move to a --dart-define at build time.
  static const supabaseAnonKey = 'sb_publishable_FsmQqvlpSgCAkBDPaR-bOQ_8V4869QD';
  static const apiBaseUrl = 'https://vw7zy9mkyg.us-east-2.awsapprunner.com/api/v1';
  static const connectTimeout = Duration(seconds: 15);
  static const receiveTimeout = Duration(seconds: 15);

  /// Set to false for physical NFC tag testing
  static const bool kUseMockNfc = false;
}
