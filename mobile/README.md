# Authentic Materials — Creator app (Flutter)

The app Creators use to seal their pieces (S-MOB2). Everything with money, sign-up and account recovery happens on
the web app; the app links out, and the website links back with "Open the app" only when the visit started here.

Plan: `../docs/plans/2026-10-28-s-mob1.md`. Research: `projectClaude/reports/DR-21 Flutter passkeys and step-up.md`.

## Run and build

Settings come from an env file, never from the code:

```bash
flutter run --dart-define-from-file=env/staging.json
flutter build ipa --dart-define-from-file=env/staging.json         # TestFlight
flutter build appbundle --dart-define-from-file=env/staging.json   # Play internal testing
flutter test
flutter analyze
```

`env/staging.json` holds public values only (URLs, the Supabase publishable key). `env/prod.json` is created at launch
from `env/prod.example.json`.

## Rules

- Session and refresh token live in the keychain / Keystore (`core/storage/secure_session_storage.dart`), never in
  SharedPreferences. Android backups are off.
- Every request sends `X-App-Version` + `X-App-Platform`; the server refuses versions below its minimum with
  `app_update_required` and the app shows the update screen.
- Incoming links: only `https://<web host>/app/open` is accepted, and it carries at most an email hint
  (`core/links/web_links.dart`). Never a token.
- Minimums: iOS 16, Android 9 (API 28), for passkeys.
