# S-MOB1 Phase B — Creator app sign-in second step: verification

**Date:** 2026-10-28 · **Branch:** `feature/s-mob1-b` · **Plan:** `docs/plans/2026-10-28-s-mob1.md` (Phase B)
**Status:** ✅ **verified on iPhone 2026-10-28** (TestFlight build 0.1.0+7, staging). Android deferred (no device). No database change, no backend code change.

## What shipped

### App (`mobile/`)
- `features/mfa/data/mfa_models.dart`, `mfa_api.dart`: typed client for `GET /auth/mfa/status`, `POST /sign-in/options`,
  `POST /sign-in/verify` (passkey / `totp` / `recoveryCode` bodies exactly as the backend's strict Zod schema). An
  unreadable answer becomes `bad_response`, never a crash.
- `passkey_client.dart` (interface, closed failure set, fake) + `corbado_passkey_client.dart` (`passkeys` 2.23.1, no
  Corbado backend). Fills `transports: []` on `allowCredentials` (#322); maps platform errors to
  cancelled / noCredential / unsupported / notAssociated / timeout / failed and logs the raw error (#323).
  Explicit tap → `preferImmediatelyAvailableCredentials: false` so a security key or another device can be used.
- `features/account/data/account_type_reader.dart`: own `users` row, `account_type` column only (RLS own-row).
- `features/mfa/session_gate.dart`: `decideGate` (second step → method set-up → Creator → ready) and a controller that
  reloads only when a *different* person signs in (no splash flash on token refresh), drops stale answers, signs out on 401.
- Router order: update required → loading → signed out → session gate. Routes `/verify`, `/setup-required`,
  `/creators-only`, `/problem`; home unreachable until ready.
- Screens: **Confirm it's you** (passkey first; authenticator code with `oneTimeCode` + Android `2faAppOTPCode` hints;
  backup code with no hint; lock-out time, passkey still works; low backup codes notice at ≤ 3; Recover by email
  (not for staff) → website; Sign out). **Add a second sign-in step** (website link until phase C, "I've set it up").
  **This app is for creators** (Become a creator → website, Check again, Sign out). **We couldn't finish signing you in**.
- Links: `/app/open` accepted from the web host **and** `authentic-materials.com`; still only an email hint is read.

### Website (`frontend/`)
- `features/app/fromApp.ts`: `from=app` (exact value only), kept for the tab (sessionStorage, memory fallback),
  carried through the sign-up confirmation (`/register/confirmed?from=app`), password reset (`/reset-password?from=app`)
  and the identity-check return URL.
- `features/app/OpenAppButton.tsx`: **Open the Authentic Materials app**, only with the flag, on: email confirmed,
  password updated, "You're a creator" and "We're checking your identity". Link = `<VITE_APP_OPEN_ORIGIN or
  https://authentic-materials.com>/app/open[?email=<own email>]`; nothing from the URL can change it; never a token.
- New `/register/confirmed` page; app sign-ups that still need email confirmation see "Check your email".
- `pages/AppOpenPage.tsx` at `/app/open` on **both** builds (public: no build settings, no API call; staging: optional
  `VITE_TESTFLIGHT_URL` / `VITE_PLAY_TESTING_URL` https links).

**Why the link goes to the other domain:** iOS opens an app from a universal link only when the link's domain differs
from the page it's tapped on. Both domains are already in the app's Associated Domains / App Links (phase A).

## Checks

| Check | Result |
|---|---|
| `flutter analyze` | 0 issues |
| `flutter test` | 70 passed (was 36) |
| `npx tsc --noEmit` (frontend) | 0 errors |
| frontend vitest | 455 passed (was 431), incl. `publicSite.test.ts` (public bundle now reaches `AppOpenPage`, still no app code, no build settings, one network call) |
| Debug Android build + unsigned iOS build (staging config) | both succeed |

## Boss actions before the device test

1. **App Runner** `WEBAUTHN_ORIGINS=https://d1bwev65w7rqzl.cloudfront.net,android:apk-key-hash:dvIAkPKF44fL71TySUKMCE5gzwVNt6UFF02CeQcX_yY`
   (debug key; matches `assetlinks.json`). iOS needs nothing: the app reports `https://<RP_ID>`. Add the upload / Play
   signing hashes at phase C. Setting the var replaces the default, so the web origin must stay first.
2. **Supabase → Auth → URL configuration:** allow `https://d1bwev65w7rqzl.cloudfront.net/register/confirmed` and
   `https://d1bwev65w7rqzl.cloudfront.net/reset-password` (or a wildcard covering them), else the email links fall back
   to the Site URL and the flag is lost.
3. Deploy: `scripts/deploy-frontend.sh staging` **and** `scripts/deploy-frontend.sh public` (`/app/open` on the public site).
4. Apple: Associated Domains on App ID `com.authenticmaterials.tags` + new profile (phase A list).

## Device test (iPhone, TestFlight 0.1.0+7, 2026-10-28)

Each result read back from the backend `auth.mfa` log (`sign-in/verify`) or the database, not only as reported.

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Creator, passkey (iCloud Keychain, Face ID) → home | ✅ | 21:23 + 21:26 UTC `method passkey ok`, actor `d7c022a9` = **admin2@** (Creator; Boss used admin2@, not test@) |
| 2 | Authenticator code: wrong → plain message, right → home | ✅ | 21:31:27 `totp invalid_code`, 21:31:44 `totp ok`, actor `d32619fb` = admin@ (only account with an authenticator app) |
| 3 | Collector after second step → "This app is for creators" | ✅ | 21:35 `passkey ok`, actor `885d30e1` = test2@ (Collector) |
| 4 | App → website sign-up → confirmation email → `/register/confirmed` → **Open the Authentic Materials app** → app at sign-in, email filled | ✅ | Boss; cross-domain link (staging page → authentic-materials.com/app/open) opened the app |
| 5 | Airplane mode → plain message, Try again after reconnect | ✅ | Boss |
| — | Backup code sign-in | not run on device (unit + widget tests only) | |
| — | Android | **deferred** (Boss has no Android phone); one real-phone check before launch | |

Notes:
- Face ID ran inside the system passkey sheet; the app needs no `NSFaceIDUsageDescription` (it never calls LocalAuthentication). Server requires user verification (`userVerification: 'required'`).
- **1Password does not fill the authenticator code** on the app's code screen (password fill works). Field is `oneTimeCode`. Follow-up in phase C: check the 1Password item (website + code in the same item), compare with iOS Passwords, decide if anything in the app can help.
- Throwaway sign-up account created on staging during check 4 (Boss's +alias); delete from Admin → Accounts when convenient.

## Open
- Android device check (above). 1Password code fill (above).
- Production: the web app's host is not decided; `VITE_APP_OPEN_ORIGIN` must point at a domain other than the one
  serving the finish screens (S-LAUNCH1).
- Home shell tabs (Seal / Security / Account) land with phase C's Security screen.
