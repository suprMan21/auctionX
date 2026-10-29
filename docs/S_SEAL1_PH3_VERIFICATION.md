# S-SEAL1 Ph3 — Flutter seal widget — Verification

**Date:** 2026-10-29 · **Branch:** `feature/s-seal1-ph3` (merged to `dev` `32abcd0`, pushed) · **Build:** 0.1.0+9
**Status:** ✅ **verified on iPhone 2026-10-29** (TestFlight 0.1.0+9, all 5 checks passed, Boss). Android 9 check deferred (no device).

The Creator app can now draw the seal: the same geometry, seal spec, colours and fonts as the website's
`SealBadge` and the server's seal pictures. S-MOB2 uses it for the "Sealed" moment after recording. No backend,
database or website change.

## What shipped

| Part | File |
|---|---|
| Geometry (same constants as backend + website, pinned hash) | `mobile/lib/shared/seal/seal_geometry.dart` |
| SVG path reader (M / L / Q / Z only; anything else refused) | `mobile/lib/shared/seal/svg_path.dart` |
| Seal spec model (`SealSpec.tryParse`, same M / l / Z rule as server + web), colours, seal code check | `mobile/lib/shared/seal/seal_spec.dart` |
| `SealBadge` widget: Verified (Shimmer) / Sealed / generic | `mobile/lib/shared/seal/seal_badge.dart` |
| Bundled fonts (same TTFs the server uses; never fetched at runtime) | `mobile/assets/fonts/` (+ OFL licences) |
| Seal preview screen, **test builds only** (no route in a prod build) | `mobile/lib/features/seal_preview/seal_preview_screen.dart`, Home → Seal preview |

**Looks.** Verified: text ring turns every 12 s, 3 s glow pulse, pattern rings turn (outer 48 s one way, inner 30 s
the other), holographic ring lines, faint rainbow sheen, glint sweeps 1 s after the seal appears, then every 30 s.
Sealed: white still rings, no sheen, no glow, muted (`saturate(.6) brightness(.82)`, same as web + server).
No spec → no pattern; no code → generic seal (same as the server's generic picture).

**Reduce Motion.** Stops everything when either Android "Remove animations" (`MediaQuery.disableAnimations`) or iOS
Reduce Motion (`accessibilityFeatures.reduceMotion`) is on, including when it is switched on while the seal is showing.

**Performance (AC 7).** No ShaderMask. Body, fixed centre and text ring each sit in their own RepaintBoundary. The text
ring and the glow pulse move by transform / opacity only (no repaint). The body (badge, sheen, rings, glint) repaints
each frame only while Verified is moving, because the Shimmer rings' colours turn independently of the rings; Sealed
and Reduce Motion never repaint. Tickers stop when the seal is off screen (TickerMode).

## Checks run (Claude, 2026-10-29)

- `flutter analyze`: no issues. `flutter test`: **117 passed** (23 new: geometry hash, path reader, spec parsing incl.
  refusals, seal code, motion on/off for Verified / Sealed / Remove animations / iOS Reduce Motion switched on live,
  screen-reader label, 6 goldens, prod build has no preview route).
- Golden `sealed_wav4.png` compared by eye with the server's own picture of the same seal (`sealSvg`, resvg):
  same pattern, ring text start (9 o'clock, clockwise), code position, colours.
- `flutter build ios --no-codesign --dart-define-from-file=env/staging.json`: built.

Goldens are drawn on macOS; regenerate with `flutter test --update-goldens test/shared/seal` after a deliberate change.

## Boss: iPhone check (build 0.1.0+9)

The preview only exists in staging builds (`ENV` = `staging`): Home → **Seal preview**, below Security. Sign in as any
Creator (test@, admin@ or admin2@) and finish the second step first; Collectors never reach Home.

### Option A — TestFlight (same route as builds 7 and 8)

Run in your own terminal (not with a `!` prefix):

```bash
# 1. Push dev (also carries S-MOB1 Ph C; no backend change in this phase)
cd ~/devProjects/Dev/dev/projectClaude/unmentionables/Unmen
git checkout dev && git push origin dev

# 2. Build the signed archive + IPA, staging settings
cd mobile
flutter clean && flutter pub get
flutter build ipa --release \
  --dart-define-from-file=env/staging.json \
  --export-options-plist=ios/ExportOptions.plist

# 3. Upload: opens the archive in Xcode's Organizer
open build/ios/archive/Runner.xcarchive
```

In Organizer: select **Runner 0.1.0 (9)** → **Distribute App** → **TestFlight & App Store** → Distribute.
(Or drag `build/ios/ipa/*.ipa` into Apple's **Transporter** app and press Deliver.) After App Store Connect finishes
processing (usually 5 to 15 min), update the app from TestFlight on the iPhone.

Tester notes: *"New: Seal preview on Home (test builds only). Also carries the Security screen from build 8."*

### Option B — straight to the iPhone over the cable (no TestFlight, no push)

Plug the iPhone into the Mac, unlock it, trust the Mac, then:

```bash
cd ~/devProjects/Dev/dev/projectClaude/unmentionables/Unmen/mobile
flutter devices                      # copy the iPhone's id from the list
flutter run --release -d <iphone-id> --dart-define-from-file=env/staging.json
```

This replaces the TestFlight copy on the phone until the next TestFlight install. Developer Mode must be on
(Settings → Privacy & Security → Developer Mode) the first time.

### Checks — ✅ all passed on iPhone 2026-10-29 (Boss)

1. Verified seal (WAV4-F6TT): rings turn, colours shift, a glint crosses about 1 s after the screen opens. **Show
   again** restarts it.
2. Sealed seal: still, muted, white rings. Matches chip_004's seal on the website's My Seals.
3. Small sizes (88 / 44): the code is readable at 88; 44 is the badge size for lists.
4. Settings → Accessibility → Motion → **Reduce Motion** on, back to the app: nothing moves (the note above the seal
   says so). Off again: it moves.
5. Scroll the screen quickly while Verified is moving: no stutter.

Android 9 check (AC 7) waits for an Android phone (S-MOB1 Android is deferred, no device).

## Not in this phase

Seal in a real app screen (S-MOB2: the "Sealed" moment, then Verified after the server confirms), tilt shine (G2),
creator colours (S-SEAL2).

## Follow-up (same day)

App icon 1.1 (`artAssets/aM_appIcon_1.1`, dark, gradient AM) replaces the placeholder on iOS and Android (adaptive +
monochrome); build **0.1.0+10** (`dev` `6d346e1`). Regenerate with `dart run flutter_launcher_icons`, then revert the
tool's `project.pbxproj` change (it sets `ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS = AppIcon`).
