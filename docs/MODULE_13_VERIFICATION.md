# Module 13: NFC Verification System

**Status:** ✅ Complete
**Date:** 2026-03-02
**Branch:** dev

---

## Build Status

| Target | Result |
|--------|--------|
| Frontend TypeScript | ✅ 0 errors |
| Backend TypeScript | ✅ 0 errors |
| Production Build | ✅ PASS |

---

## Overview

NFC verification is AuctionX's core authenticity differentiator. Sellers attach NTAG 424 DNA tags to items, record a 15–30 second possession-proof video, and program the tag with a unique verify URL. Buyers scan the tag to view the item's full chain of custody.

---

## Files Created

| File | Description |
|------|-------------|
| `supabase/migrations/20260301100000_nfc_verification.sql` | DB schema: item_verifications, ownership_transfers, generate_token_name RPC, RLS policies |
| `backend/src/lib/s3.ts` | S3 presigned URL generator (AWS SDK v3) |
| `backend/src/controllers/verificationController.ts` | 6 handlers: create, getUploadUrl, confirmVideoUpload, registerNfc, getVerificationByToken, incrementScanCount |
| `backend/src/routes/verifications.ts` | Two exported routers: verificationRoutes + publicVerificationRoutes |
| `frontend/src/features/verification/types/verification.ts` | Verification, OwnershipTransfer, VerificationDetail types |
| `frontend/src/features/verification/pages/TokenCreationPage.tsx` | 5-step mobile PWA wizard (intro → record → upload → NFC → success) |
| `frontend/src/features/verification/pages/VerificationPage.tsx` | Public chain-of-custody page |

## Files Modified

| File | Change |
|------|--------|
| `backend/src/server.ts` | Mounted `/api/v1/verifications` + `/api/v1/verify` |
| `frontend/src/lib/api.ts` | Added 6 verification API methods |
| `frontend/src/App.tsx` | Added `/verify/create/:verificationId` + `/verify/:tokenName` routes (order matters) |
| `frontend/src/pages/CreateListing.tsx` | NFC verification toggle checkbox + post-create flow |
| `frontend/src/components/listings/ListingCard.tsx` | VERIFIED badge + item_verifications prop |
| `frontend/src/pages/BrowsePage.tsx` | item_verifications join in Supabase query |
| `frontend/src/pages/SearchResultsPage.tsx` | item_verifications join in Supabase query |
| `supabase/functions/release-escrow/index.ts` | Non-fatal ownership transfer on escrow release |

---

## Routes Added

### Backend

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/verifications/create` | JWT | Create verification for owned listing |
| POST | `/api/v1/verifications/:id/upload-url` | JWT | Get S3 presigned PUT URL |
| POST | `/api/v1/verifications/:id/upload-video` | JWT | Confirm video upload (15–30s validation) |
| POST | `/api/v1/verifications/:id/register-nfc` | JWT | Register NFC UID (conflict checked) |
| GET | `/api/v1/verify/:tokenName` | Public | Get full verification detail + increment view |
| POST | `/api/v1/verify/:tokenName/scan` | Public | Increment scan count |

### Frontend

| Path | Auth | Component |
|------|------|-----------|
| `/verify/create/:verificationId` | Protected | TokenCreationPage |
| `/verify/:tokenName` | Public | VerificationPage |

---

## Database Schema

### `item_verifications`
- `token_name` — unique, format: `{username}_{nn}` (generated via RPC)
- `status` — PENDING → VIDEO_UPLOADED → NFC_PROGRAMMED → VERIFIED (or FLAGGED/REVOKED)
- `current_owner_id` — updated on ownership transfer
- `scan_count`, `view_count`, `share_count` — engagement metrics

### `ownership_transfers`
- Created automatically by release-escrow edge function on escrow release
- Links `verification_id → settlement_id` for full audit trail

### RLS
- Public SELECT for VERIFIED/VIDEO_UPLOADED/NFC_PROGRAMMED
- Seller ALL on own rows
- Current owner SELECT
- Service role INSERT on transfers

### Migration idempotency notes
The migration was designed to survive a failed prior push attempt:
- Enum creation uses `DO $$ BEGIN CREATE TYPE ... EXCEPTION WHEN duplicate_object THEN NULL END $$`
- Each enum value uses `ALTER TYPE ... ADD VALUE IF NOT EXISTS` to fill in any missing labels
- Tables use `CREATE TABLE IF NOT EXISTS`; indexes use `CREATE INDEX IF NOT EXISTS`
- Trigger uses a `DO` block with `duplicate_object` guard
- Policies use `DROP POLICY IF EXISTS` before `CREATE POLICY`
- RLS policy `USING` clause casts `status::text IN (...)` instead of using enum literals directly — required to avoid PostgreSQL error `55P04 "unsafe use of new enum value"`, which fires when newly-added enum values are referenced as typed literals in the same transaction

---

## Known Gaps / Future Work

- **iOS NFC writing**: Web NFC API not supported on iOS. Users directed to NFC Tools app.
- **NTAG 424 DNA cryptographic verification**: Anti-counterfeit server-side SUN message verification not implemented (future).
- **Realtime**: VerificationPage does not yet subscribe to live scan count updates.

---

## Environment Variables Required

### Backend `.env`
```
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
S3_BUCKET=auctionx-media-prod-cl
```

---

## Deployment Checklist

- [x] `npx supabase db push` — migration applied (2026-03-02)
- [x] Types regenerated — `item_verifications` + `ownership_transfers` now in `database.types.ts` (21 tables)
- [ ] Verify AWS credentials in backend `.env` (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET`)
- [ ] Deploy `release-escrow` edge function (ownership transfer block added)
