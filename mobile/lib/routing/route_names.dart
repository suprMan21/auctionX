class RouteNames {
  RouteNames._();

  static const splash = '/';
  static const update = '/update';
  static const signIn = '/sign-in';
  static const home = '/home';
  static const secondFactor = '/verify';
  static const setupRequired = '/setup-required';
  static const creatorsOnly = '/creators-only';
  static const problem = '/problem';
  static const security = '/security';

  /// S-MOB2 recorded sealing.
  static const sealPrep = '/seal';
  static const sealTake = '/seal/take';
  static const sealResult = '/seal/result';

  /// Test builds only.
  static const sealPreview = '/seal-preview';
  static const readCheck = '/read-check';
}
