# S-MOB1 Phase C — Creator app: manage sign-in methods: verification

**Date:** 2026-10-28 · **Branch:** `feature/s-mob1-c` · **Plan:** `docs/plans/2026-10-28-s-mob1.md` (Phase C)
**Status:** code done, tests green; **device test pending** (TestFlight 0.1.0+8). No database change, no backend change
(every endpoint already existed for the website).

## What shipped (app only, `mobile/`)

- **Security screen** (`/security`, from Home → Security): passkeys (name, synced or one device, added, last used,
  "Can approve changes from …" during the 24 h wait), authenticator app (On / wait / Turn off, or Set up), backup codes
  left (warning at ≤ 3), Make new backup codes; link to the website for backup email and recovery. Pull to refresh.
  The break-glass account sees "Add a security key" and no authenticator app.
- **Add a passkey**: name (default iPhone / Android phone; same nickname rule as the backend) → confirm it's you
  (`factor_add`, target `passkey`; skipped for the account's first method) → OS sheet → saved. `PasskeyClient.create`
  on Corbado `register`, with `transports: []` filled on `excludeCredentials` (same parser gap as #322) and base64
  padding stripped. New failure `alreadyOnThisDevice`; "Set a screen lock, or use an authenticator app" when the
  phone can't make one.
- **Authenticator app**: confirm (`factor_add`, target `totp`, unless first) → setup screen: **Open in authenticator
  app** (`otpauth://`), QR code for another device, setup key grouped by 4 with Copy → 6-digit code → On.
- **Backup codes**: shown once (first method, or Make new codes after `recovery_regen` confirm); Copy, Share;
  **Done** only after "I've saved these codes somewhere safe"; back is blocked until then.
- **Remove** a passkey / turn off the app: "are you sure" → confirm (`factor_remove`, `passkey:<id>` / `totp`).
  The last method can't be removed (stopped before the confirm, so no confirm is wasted).
- **Confirm it's you** sheet (`step_up_sheet.dart`): passkey first, authenticator code, backup code; lock-out time;
  method rules in `allowedStepUpMethods` (S-MOB2 adds `seal`). Grant goes in `X-Step-Up`, never the body.
- After any change: "You were signed out on your other devices" when the server says so; a method added with a
  code shows when it can approve changes.
- **Set-up required** gate now adds the first method in the app (passkey or authenticator app, no confirm, backup
  codes, then the gate moves on). "I set one up on the website" stays as a fallback.
- Low backup codes notice now says "Make new ones in Security".

## Checks

| Check | Result |
|---|---|
| `flutter analyze` | 0 issues |
| `flutter test` | 95 passed (was 70): API bodies + headers vs backend Zod schemas, models, register options parse with a real `@simplewebauthn` shape, padding, error words, flows (remove / add / codes / cancel / first method), set-up gate, authenticator setup, 200 % text |
| `flutter build ios --no-codesign` (staging) | ✅ |
| `flutter build apk --debug` (staging) | ✅ |

## Boss: build and test

1. Xcode: archive build **0.1.0+8** with `--dart-define-from-file=env/staging.json` and upload to TestFlight
   (same steps as build 7). Tester notes: *"New: Security in the app. Add or remove passkeys, set up an authenticator
   app, make new backup codes."*
2. No server settings needed (iOS registers with the same origin it signs in with).

## Device test (iPhone, TestFlight 0.1.0+8)

Read each result back from the `auth.mfa` log / database, as in phase B.

| # | Check | Account | Result |
|---|---|---|---|
| 1 | Home → Security lists the right passkeys, app, codes left | admin2@ | |
| 2 | Add a passkey: name → confirm with existing passkey → Face ID → listed, **no** wait line | admin2@ | |
| 3 | Sign in on the website with the passkey made in the app | admin2@ | |
| 4 | Add a passkey confirmed with an **authenticator code** → "can approve changes from …" (+24 h), email received | admin@ | |
| 5 | Set up authenticator app via **Open in authenticator app** (iOS Passwords or 1Password), code accepted | test@ or a throwaway Creator | |
| 6 | Make new backup codes → Done disabled until ticked; an old code no longer works | admin2@ | |
| 7 | Remove a passkey (confirm with another) → gone; website session on another device signed out | admin2@ | |
| 8 | Only one method left → Remove says "Add another way first" | any | |
| 9 | New Creator with no method → set-up screen → Add a passkey in the app → backup codes → home | throwaway | |

## Open

- Android device check (no device; one real phone before launch). Play internal testing track needs the Play Console
  entry + upload key (plan Boss action 2); Android `WEBAUTHN_ORIGINS` then needs the upload / Play signing hashes.
- 1Password code fill on the sign-in code screen (phase B note): check #5 shows whether adding through
  `otpauth://` into 1Password makes it offer the code.
