# Session R — Flutter Minting Flow + Video Proof Backend Wiring (Phase 6C-D)

## Context

**Branch:** `feature/flutter-video-proof`
**Previous sessions:**
- Session O: Flutter app init + auth + navigation shell
- Phase 6B: NFC scanning with NTAG 424 DNA SUN protocol (nfc_manager + offline queue)
- Phase 6C: Video proof recording **already built** — camera capture (15-60s), preview with retake/confirm, video_compress compression, S3 presigned URL upload with progress tracking

**What's done in mobile/:**
- Clean architecture (data/domain/presentation layers)
- Riverpod state management + Freezed models
- NFC scanning: NDEF parsing, SUN URL extraction, picc_data + cmac → backend validation
- Video proof: 3 screens (record → preview → upload), full state machine
- Auth: Supabase GoTrue with JWT auto-injection
- Deep links: `/verify?picc_data=...&cmac=...` auto-triggers scan validation
- Routing: GoRouter with shell scaffold, all video routes wired
- Offline: Hive queue for NFC scans, connectivity-based sync

**What's NOT done:**
1. Backend `/nfc/proof` endpoint doesn't exist yet — the Flutter app POSTs to it for presigned URL but there's no route
2. NFT minting flow in Flutter (Phase 6D) — no screens, no state, no backend integration
3. Video overlay is display-only (tag UID + timestamp shown on screen but NOT burned into the video file)
4. NFC mock flag (`kUseMockNfc`) is still `true`
5. No end-to-end flow connecting scan → video proof → mint → verification page

## Goals for This Session

### 1. Backend: Video Proof Upload Endpoint
Create `POST /api/v1/nfc/proof` in the Express backend:
- Auth required (JWT)
- Request body: `{ tagId: string, contentType: string, fileSize: number }`
- Generate S3 presigned PUT URL for `video-proofs/{tagId}/{uuid}.mp4`
- Return: `{ uploadUrl: string, publicUrl: string, videoKey: string }`
- After upload confirmation: update `item_verifications` table with `video_proof_url`
- Add `POST /api/v1/nfc/proof/confirm` to mark upload complete + store URL in DB

### 2. Flutter: NFT Minting Flow (Phase 6D)
After scan + video proof verified, build the minting experience:

**New files needed in `features/nfc/` or new `features/minting/` feature:**
- **MintConfirmScreen** — shows summary (tag info, video thumbnail, item details), "Mint Authentication NFT" button
- **MintProgressScreen** — triggers `POST /api/v1/verify/mint` via backend, shows minting progress (submitted → pending → confirmed), displays minted NFT with transaction link (Base Sepolia explorer)
- **MintSuccessScreen** — shows NFT details, shareable verification page link, "Share" button (generates link to `/verify/:tagId` web page), "Done" button returns to scan screen

**State management:**
- `MintProvider` (Riverpod notifier): requestMint(tagId) → polling for tx confirmation → success/error
- States: idle → requesting → submitted → confirming → minted → error

**Router additions:**
- `/home/nfc/mint-confirm` — receives tagId, tagUid, videoProofUrl
- `/home/nfc/mint-progress` — receives tagId
- `/home/nfc/mint-success` — receives tagId, txHash, tokenId

### 3. Connect the End-to-End Flow
Wire the complete flow in the NFC scan screen:
1. User scans NFC tag → validated by backend
2. If tag needs video proof → navigate to video record screen
3. After video upload complete → navigate to mint confirm screen
4. After mint complete → show success with shareable link
5. Return to scan screen

### 4. Verify Backend Endpoints Exist
Check that these backend routes (from Session L/M/N) actually work:
- `POST /api/v1/verify/scan` — validates NFC tag (used by Flutter)
- `POST /api/v1/verify/mint` — triggers NFT mint (used by new minting flow)
- `GET /api/v1/verify/:tagId` — public verification data (used by share link)

If any are 501 stubs, implement them or note as deferred.

## Architecture Notes

**Existing patterns to follow:**
- All API calls go through `ApiClient` (Dio + JWT interceptor) at `core/network/api_client.dart`
- State management: Riverpod `StateNotifier<AsyncValue<T>>` pattern (see `nfc_scan_provider.dart`)
- Entities in `domain/entities/`, repos as abstract classes in `domain/repositories/`
- Remote datasources in `data/datasources/`, repo implementations in `data/repositories/`
- Screens use `ConsumerStatefulWidget` or `ConsumerWidget`
- UI follows dark theme from `core/constants/app_colors.dart` — glassmorphism cards, purple→blue gradients
- Error handling: `dartz` Either type (Left = Failure, Right = success)

**S3 bucket:** `auctionx-media-prod-cl` in us-east-2
**Supabase tables:** `item_verifications`, `nfc_tags`, `nft_metadata`, `verification_events`

## What NOT to Do
- Don't rebuild video proof recording — it's complete
- Don't modify locked modules (`functions/src/v1/schemas/domain/`, `functions/src/v1/services/auctions/`)
- Don't burn overlay into video file (display-only is intentional per current design)
- Don't switch NFC mock flag to false (needs physical device testing)
- Don't touch payment cascade code

## Session-End Checklist
1. `flutter analyze` — 0 issues
2. `flutter build apk --debug` — success
3. `flutter build ios --debug --no-codesign` — success
4. `cd frontend && npx tsc --noEmit` — 0 errors
5. `cd backend && npx tsc --noEmit` — 0 errors
6. Commit: `feat(phase-6d): Flutter NFT minting flow + video proof backend endpoint`
7. Create session handoff in Notion
8. Add lessons learned to DB
9. Merge to dev if clean

## Key Files Reference

**Flutter app entry:** `mobile/lib/main.dart`
**Router:** `mobile/lib/routing/app_router.dart`
**NFC scan provider:** `mobile/lib/features/nfc/presentation/providers/nfc_scan_provider.dart`
**Video proof provider:** `mobile/lib/features/video_proof/presentation/providers/video_proof_provider.dart`
**Video upload datasource:** `mobile/lib/features/video_proof/data/datasources/video_proof_remote_datasource.dart`
**API client:** `mobile/lib/core/network/api_client.dart`
**API constants:** `mobile/lib/core/constants/api_constants.dart`
**Backend routes:** `backend/src/routes/` (check for existing nfc/verify routes)
**NFC controller:** `backend/src/controllers/` (check for existing verification controller)
