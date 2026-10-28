/// Build-time settings, passed with `--dart-define-from-file=env/<env>.json`.
///
/// Nothing here is secret: the Supabase publishable key and the URLs ship in
/// every build. Keeping them out of the code means a key rotation needs a new
/// build, not a code change (the old hard-coded key went stale on 2026-06-21).
class AppConfig {
  const AppConfig({
    required this.env,
    required this.supabaseUrl,
    required this.supabasePublishableKey,
    required this.apiBaseUrl,
    required this.webBaseUrl,
    required this.rpId,
  });

  /// `staging` or `prod`.
  final String env;
  final String supabaseUrl;
  final String supabasePublishableKey;

  /// Backend base, ending in `/api/v1`, no trailing slash.
  final String apiBaseUrl;

  /// The web app (sign-up, recovery, everything with money). No trailing slash.
  final String webBaseUrl;

  /// Passkey relying-party ID. Must match the backend's WEBAUTHN_RP_ID.
  final String rpId;

  bool get isProd => env == 'prod';

  /// Host of the web app; the only host the app accepts links from.
  String get webHost => Uri.parse(webBaseUrl).host;

  static const _keys = [
    'ENV',
    'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY',
    'API_BASE_URL',
    'WEB_BASE_URL',
    'RP_ID',
  ];

  /// Reads the values compiled into this build.
  static AppConfig fromEnvironment() => fromMap(const {
        'ENV': String.fromEnvironment('ENV'),
        'SUPABASE_URL': String.fromEnvironment('SUPABASE_URL'),
        'SUPABASE_PUBLISHABLE_KEY': String.fromEnvironment('SUPABASE_PUBLISHABLE_KEY'),
        'API_BASE_URL': String.fromEnvironment('API_BASE_URL'),
        'WEB_BASE_URL': String.fromEnvironment('WEB_BASE_URL'),
        'RP_ID': String.fromEnvironment('RP_ID'),
      });

  /// Checks every value. A build with a missing or bad value fails at start-up
  /// instead of talking to the wrong server.
  static AppConfig fromMap(Map<String, String> values) {
    final missing = _keys.where((k) => (values[k] ?? '').trim().isEmpty).toList();
    if (missing.isNotEmpty) {
      throw AppConfigError('Missing build settings: ${missing.join(', ')}. '
          'Build with --dart-define-from-file=env/staging.json');
    }
    String v(String k) => values[k]!.trim();

    final env = v('ENV');
    if (env != 'staging' && env != 'prod') {
      throw AppConfigError('ENV must be staging or prod, got "$env"');
    }
    for (final k in ['SUPABASE_URL', 'API_BASE_URL', 'WEB_BASE_URL']) {
      final uri = Uri.tryParse(v(k));
      if (uri == null || uri.scheme != 'https' || uri.host.isEmpty) {
        throw AppConfigError('$k must be an https URL');
      }
    }
    final rpId = v('RP_ID');
    if (rpId.contains('/') || rpId.contains(':')) {
      throw AppConfigError('RP_ID must be a bare host name');
    }

    String trimSlash(String s) => s.endsWith('/') ? s.substring(0, s.length - 1) : s;
    return AppConfig(
      env: env,
      supabaseUrl: trimSlash(v('SUPABASE_URL')),
      supabasePublishableKey: v('SUPABASE_PUBLISHABLE_KEY'),
      apiBaseUrl: trimSlash(v('API_BASE_URL')),
      webBaseUrl: trimSlash(v('WEB_BASE_URL')),
      rpId: rpId,
    );
  }
}

class AppConfigError implements Exception {
  AppConfigError(this.message);
  final String message;
  @override
  String toString() => 'AppConfigError: $message';
}
