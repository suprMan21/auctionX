# S-MOB1 Phase A — Creator app reset + foundations: verification

**Date:** 2026-10-28 · **Branch:** `feature/s-mob1-a` (`3465a40`, `021916a`, `9cb5e93`) · merged to `dev` `0c7ed13`
**Plan:** `docs/plans/2026-10-28-s-mob1.md` (Phase A) · **Next:** `docs/S_MOB1_B_VERIFICATION.md`
**Status:** ✅ done. Pushed and deployed by Boss; iOS build 0.1.0+6 in TestFlight; Android upload bundle built and signed.

## What shipped

### App (`mobile/`)
- Marketplace-era features removed (minting, browse, seller, video_proof, activity, onboarding, old NFC screens,
  register / forgot / profile; freezed, dartz, hive). Package `authentic_materials`; app name **AM - Creator**.
- One build per environment: `--dart-define-from-file=env/staging.json` (`env/prod.example.json` for later).
- Session stored in `flutter_secure_storage` 11.2 (iOS `first_unlock_this_device`); leftover keychain cleared on
  first launch; Supabase `localStorage` + `pkceAsyncStorage` on it.
- Every request sends `X-App-Version`, `X-App-Platform` and a readable User-Agent. Update gate reads
  `GET /api/v1/app-config`; a 426 `app_update_required` shows the update screen.
- `/app/open` links: only an email hint is read; links never navigate by themselves.
- iOS: deployment target 16 (Podfile forces 16.0 for pods, Xcode 27 refuses older); NFC TAG + Associated Domains
  (`webcredentials` + `applinks`, both hosts); Flutter deep linking off; old `auctionx` scheme removed.
- Android: minSdk 28, target 36, backups off (`data_extraction_rules.xml`), verified App Link for `/app/open`
  on both hosts, NDEF / `auctionx` filters removed. `MainActivity` moved to package `com.authenticmaterials.app`
  (the old package did not match the namespace and would crash at launch).
- Java 25 build: Gradle 9.1.0, AGP 9.0.1, Kotlin 2.3.20; camera ^0.12.2; permission_handler stays ^11.4.0
  (13.x needs compileSdk 37).
- Release signing reads `android/app/keystore.properties` (gitignored, with `*.jks`); falls back to debug when missing.

### Backend
- `lib/appVersion.ts`, `middleware/appVersionGate.ts`, `routes/appConfig.ts` (`GET /api/v1/app-config`, public,
  60/min, `no-store`). Env `APP_MIN_VERSION_IOS/ANDROID` (default 0.0.0, malformed = no minimum),
  `APP_UPDATE_URL_IOS/ANDROID` (https only). Requests without app headers (the website) are never gated; a
  half-sent or malformed pair is refused.

### Website
- `public/.well-known/apple-app-site-association` + `assetlinks.json` (debug key fingerprint for now);
  `deploy-frontend.sh` uploads the Apple file as `application/json` and checks both after deploy (staging + public).

## Checks

| Check | Result |
|---|---|
| `flutter test` | 36 passed |
| backend `appVersion.test.ts` | 20 passed, incl. no-private-fields on `/app-config` |
| backend full vitest (after merge with S-SEAL1) | 1126 passed / 23 skipped with `--maxWorkers=4`, twice. At full parallelism one random MFA test failed per run with "socket hang up" under machine load (load avg ~9); environmental |
| frontend tsc + vitest | 0 errors, 431 passed (`wellKnown.test.ts` included) |
| iOS IPA 0.1.0+6 | distribution-signed (team F5F52345D2), Associated Domains present, accepted by TestFlight |
| Android `.aab` 0.1.0+6 (staging) | built and signed with the upload key |

## Android upload key (Boss, 2026-10-28)

- Keystore `~/keys/am-creator-upload.jks`, alias `upload`, saved in 1Password `AM_Development`. Recreated once with a
  new password after the first password was pasted into the tracked template (never committed).
- Upload certificate SHA-256: `DE:88:F6:7A:46:F4:0E:B3:8C:9A:6D:B2:5D:8D:53:35:A8:39:12:73:82:10:B3:74:20:FE:8E:2D:21:17:04:73`
- Waiting on the Google Play developer account (Organization type recommended: no 12-tester / 14-day rule; needs a
  D-U-N-S number). Then: create "AM - Creator", internal testing, accept Play App Signing, send the app-signing
  SHA-256 → add both to `assetlinks.json` and `WEBAUTHN_ORIGINS` (phase C / M4).

## Open

- App icon is still the Flutter default (`assets/icon/app_icon.png` exists, not applied).
- Add `ITSAppUsesNonExemptEncryption=false` to Info.plist so TestFlight stops asking about export compliance.
- Git stash `s-mob1-xcode-autochanges-2026-10-28` (Xcode's automatic edits to the old project; not needed) can be dropped.
