# S-MOB1 Phase B — Creator app sign-in second step: verification

**Date:** 2026-10-28 · **Branch:** `feature/s-mob1-b` · **Plan:** `docs/plans/2026-10-28-s-mob1.md` (Phase B)
**Status:** code + tests done; **device test pending** (needs the Boss actions below). No database change, no backend code change.

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

## Device test (Boss + Claude, no chips needed)

- [ ] iPhone: sign in as a Creator (`test@`) with password → Confirm it's you → passkey made on the staging website → home.
- [ ] Android: same (needs action 1).
- [ ] Authenticator code (iOS Passwords fill / Android hint); wrong code wording; backup code + low-codes notice.
- [ ] `test2@` (Collector) → second step → "This app is for creators".
- [ ] Sign up from the app ("Create an account") → confirm email on the phone → **Open the Authentic Materials app**
      opens the app at sign-in with the email filled. Same button absent when signing up on the website directly.
- [ ] Kill the network on the second step → plain message; airplane mode at start → "We couldn't finish signing you in".

## Open
- Production: the web app's host is not decided; `VITE_APP_OPEN_ORIGIN` must point at a domain other than the one
  serving the finish screens (S-LAUNCH1).
- Home shell tabs (Seal / Security / Account) land with phase C's Security screen.
