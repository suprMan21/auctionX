/// Links between the app and the web app.
///
/// Out: account set-up happens on the website. Every link carries the fixed
/// flag `from=app`, so the website knows to offer "Open the app" at the end.
/// Website visits that didn't start in the app never carry it (Boss 2026-10-28).
///
/// In: the website sends people back with `https://<web host>/app/open`. That
/// link only opens the app; it never carries a token or a session, and the app
/// takes at most an email hint from it.
class WebLinks {
  const WebLinks(this.webBaseUrl);

  final String webBaseUrl;

  static const fromApp = 'from';
  static const fromAppValue = 'app';
  static const openPath = '/app/open';

  Uri _web(String path) =>
      Uri.parse('$webBaseUrl$path').replace(queryParameters: {fromApp: fromAppValue});

  Uri get signUp => _web('/register');
  Uri get forgotPassword => _web('/forgot-password');
  Uri get becomeCreator => _web('/settings/account-type');
  Uri get recover => _web('/sign-in/recover');

  /// Adding a passkey or authenticator app (in the app from phase C).
  Uri get securitySetup => _web('/settings/security/setup');
}

/// Result of reading an incoming link.
class IncomingLink {
  const IncomingLink({this.emailHint});
  final String? emailHint;
}

/// The public site. It serves `/app/open` too: the staging web app links there
/// because iPhone only opens an app from a link to a *different* domain than
/// the page it is tapped on. Both domains are in the app's associated domains.
const publicSiteHost = 'authentic-materials.com';

/// Accepts only `https://<web host or public site>/app/open[?email=…]`.
/// Everything else is ignored, so a link can never steer the app anywhere else.
IncomingLink? parseIncomingLink(Uri uri, {required String webHost}) {
  if (uri.scheme != 'https' || (uri.host != webHost && uri.host != publicSiteHost)) return null;
  final path = uri.path.endsWith('/') ? uri.path.substring(0, uri.path.length - 1) : uri.path;
  if (path != WebLinks.openPath) return null;
  final email = uri.queryParameters['email']?.trim();
  final valid = email != null &&
      email.length <= 254 &&
      RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(email);
  return IncomingLink(emailHint: valid ? email : null);
}
