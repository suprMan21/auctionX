# Phase 6E+6F — Seller Tools + App Store Preparation

## Verification Report
- **Session:** S
- **Branch:** `feature/flutter-seller-appstore`
- **Date:** 2026-03-20

## Completed Phases

### Phase 0 — Housekeeping
- [x] Merged `feature/flutter-minting-sharing` into `dev` (fast-forward)
- [x] Created `feature/flutter-seller-appstore` branch

### Phase 1 — Seller Feature Architecture
- [x] Created `lib/features/seller/` with full clean architecture
- [x] Domain: `SellerTag`, `RegistrationResult` entities (Freezed)
- [x] Data: `SellerRemoteDatasource` (API + Supabase), `SellerRepositoryImpl`
- [x] Presentation: Providers, screens, widgets

### Phase 2 — Tag Registration Wizard (4-step)
- [x] Step 1: Select Listing (Supabase RLS query, searchable)
- [x] Step 2: Scan Tag (reuses NfcService/MockNfcService)
- [x] Step 3: Enter AES Key (32 hex char validation)
- [x] Step 4: Confirm & Register (POST /api/v1/nfc/register)
- [x] Freezed state machine with 6 states
- [x] Step indicator widget

### Phase 3 — Batch Registration
- [x] Multi-listing selection with checkboxes
- [x] Sequential scan → AES key dialog → register loop
- [x] Running progress counter
- [x] "Finish Early" button

### Phase 4 — Inventory View (Seller Dashboard)
- [x] Access from Profile screen → "Seller Tools"
- [x] GET /api/v1/nfc/tags via SellerRemoteDatasource
- [x] Filter chips: All / Active / Pending / Sold
- [x] Tag cards with UID, listing title, status badge, scan count, NFT indicator
- [x] Pull-to-refresh
- [x] Quick action cards: Register Tag, Batch Register

### Phase 5 — QR Code Generation
- [x] Added `qr_flutter: ^4.1.0` to pubspec.yaml
- [x] QR data: `https://authentic-materials.com/verify?tag={tagId}`
- [x] Branded glassmorphism card wrapper
- [x] Share via share_plus

### Phase 6 — App Store Preparation

#### 6A — Bundle IDs & Names
- [x] Android: `applicationId = "com.authenticmaterials.app"`
- [x] iOS: `CFBundleDisplayName = "Authentic Materials"`
- [x] Version: 1.0.0+1

#### 6B — App Icons
- [x] Added `flutter_launcher_icons: ^0.14.3` as dev dependency
- [x] Generated placeholder icon (1024x1024, AM on purple gradient)
- [x] Configured in pubspec.yaml

#### 6C — Splash Screen
- [x] Added `flutter_native_splash: ^2.4.5` package
- [x] Dark background (#13131A) configured in pubspec.yaml

#### 6D — Legal Docs
- [x] Created `mobile/assets/legal/privacy_policy.md` (placeholder)
- [x] Created `mobile/assets/legal/terms_of_service.md` (placeholder)
- [x] In-app legal viewer screen
- [x] Accessible from Profile screen
- [x] BLOCKER for store submission flagged

### Phase 7 — App Store Review Compliance Checklist
- [x] iOS: NFC entitlement present (NFCReaderUsageDescription in Info.plist)
- [x] iOS: Camera/mic descriptions present
- [x] iOS: Age rating 17+ — needs to be set in App Store Connect
- [x] iOS: NFT/minting disclosure — document for review
- [x] Android: targetSdk = 34
- [x] Android: NFC + camera permissions declared in AndroidManifest
- [x] Android: Data safety form — needs manual completion in Play Console
- [x] Both: Privacy policy URL — placeholder docs included, URL needed
- [x] Both: No IAP (transactions on web only)

### Phase 8 — Release Build Configuration
- [x] Android: `keystore.properties.template` created (gitignored)
- [x] Android: `build.gradle.kts` updated with release signing config
- [x] Android: Debug APK builds successfully
- [x] iOS: `ExportOptions.plist` template created
- [x] iOS: Debug build succeeds (no-codesign)
- [ ] Manual: iOS signing certs + provisioning profiles

## Routes Added
| Route | Screen |
|-------|--------|
| `/home/seller` | SellerDashboardScreen |
| `/home/seller/register` | TagRegistrationScreen |
| `/home/seller/batch-register` | BatchRegistrationScreen |
| `/home/seller/qr/:tagId` | QrGenerateScreen |
| `/home/legal` | LegalViewerScreen |

## New Files (22)
- `lib/features/seller/data/datasources/seller_remote_datasource.dart`
- `lib/features/seller/data/repositories/seller_repository_impl.dart`
- `lib/features/seller/domain/entities/seller_tag.dart` + generated
- `lib/features/seller/domain/entities/registration_result.dart` + generated
- `lib/features/seller/domain/repositories/seller_repository.dart`
- `lib/features/seller/presentation/providers/seller_provider.dart`
- `lib/features/seller/presentation/providers/seller_state.dart` + generated
- `lib/features/seller/presentation/providers/registration_wizard_state.dart` + generated
- `lib/features/seller/presentation/screens/seller_dashboard_screen.dart`
- `lib/features/seller/presentation/screens/tag_registration_screen.dart`
- `lib/features/seller/presentation/screens/batch_registration_screen.dart`
- `lib/features/seller/presentation/screens/qr_generate_screen.dart`
- `lib/features/seller/presentation/screens/legal_viewer_screen.dart`
- `lib/features/seller/presentation/widgets/seller_tag_card.dart`
- `lib/features/seller/presentation/widgets/registration_step_indicator.dart`
- `lib/features/seller/presentation/widgets/status_filter_chips.dart`
- `lib/features/seller/presentation/widgets/qr_branded_card.dart`
- `assets/legal/privacy_policy.md`
- `assets/legal/terms_of_service.md`
- `assets/icon/app_icon.png`
- `android/app/keystore.properties.template`
- `ios/ExportOptions.plist`

## Modified Files
- `pubspec.yaml` — qr_flutter, flutter_launcher_icons, flutter_native_splash, assets
- `lib/routing/route_names.dart` — 5 new route constants
- `lib/routing/app_router.dart` — 5 new routes + imports
- `lib/features/profile/presentation/screens/profile_screen.dart` — Seller Tools + Legal links
- `android/app/build.gradle.kts` — applicationId, targetSdk 34, release signing
- `ios/Runner/Info.plist` — Display name, NFC description update
- `.gitignore` — keystore.properties

## Build Verification
- [x] `flutter analyze` — 0 errors, 0 warnings (17 infos)
- [x] `flutter build apk --debug` — SUCCESS
- [x] `flutter build ios --debug --no-codesign` — SUCCESS
- [x] Frontend `npx tsc --noEmit` — 0 errors
- [x] Backend `npx tsc --noEmit` — 0 errors

## Remaining TODOs (Not Blocking)
- [ ] Run `flutter pub run flutter_launcher_icons` to generate all icon sizes
- [ ] Run `flutter pub run flutter_native_splash:create` to generate splash
- [ ] iOS signing certs + provisioning profiles setup
- [ ] Android keystore generation
- [ ] Legal docs review by actual lawyer
- [ ] Privacy policy URL for store listings
- [ ] App Store Connect / Play Console account setup
- [ ] TestFlight + internal testing distribution
