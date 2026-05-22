# Authentic Materials — Codebase Audit Report

**Date:** February 28, 2026
**Audited by:** Claude Sonnet 4.6
**Project Root:** `/Users/chris/Desktop/projectClaude/`
**Actual Code Root:** `unmentionables/Unmen/`

---

## Executive Summary

The codebase is architecturally sound but has accumulated significant drift between documentation, database types, and runtime code. The locked Zod schemas (Module 01) are **non-functional** without Firebase and are completely disconnected from the actual Supabase database. The backend database types file is stale (9 tables vs. 19 in production), causing TypeScript errors in payment and webhook routes. The frontend has ~15 TypeScript errors spanning profile, listing, and dashboard pages. Several "production ready" modules have real bugs that would cause runtime failures.

**Build Status:** ❌ Frontend: ~15 TS errors | ❌ Backend: ~12 TS errors

---

## Section 1: Directory Structure

### ❌ CLAUDE.md Documents Wrong Root

CLAUDE.md describes this structure:
```
projectClaude/
├── frontend/
├── backend/
├── supabase/
├── functions/
└── docs/
```

Actual structure of `/Users/chris/Desktop/projectClaude/`:
```
projectClaude/          ← working directory (CWD)
├── CLAUDE.md
├── docs/               ← TOP-LEVEL docs (partial: 4 files, no SCHEMA_LOCK.md)
├── projectClaude/      ← REDUNDANT NESTED COPY (only has .claude/ and docs/)
└── unmentionables/
    └── Unmen/          ← ACTUAL PROJECT ROOT
        ├── backend/
        ├── frontend/
        ├── functions/  ← Firebase-era locked modules
        ├── supabase/
        └── docs/       ← Full docs (22 files)
```

**Impact:** Every path reference in CLAUDE.md is wrong. Commands like `cd frontend && npm run dev` must be run from `unmentionables/Unmen/`.

### ⚠️ Docs Split Across Two Locations

- `/projectClaude/docs/` — 4 files: `ARCHITECTURE_REFERENCE.md`, `CONTENT_FLAG_GUIDELINES.md`, `KICKOFF_PROMPT.md`, `MODULE_STATUS.md`
- `/projectClaude/unmentionables/Unmen/docs/` — 22 files: the real docs including `SCHEMA_LOCK.md`, all MODULE_XX references, etc.
- `SCHEMA_LOCK.md` is NOT in the top-level docs (CLAUDE.md says it is)

### ✅ Actual Project Structure Matches Module Status Claims

Within `unmentionables/Unmen/`, the directory layout matches what MODULE_STATUS.md describes.

---

## Section 2: Package Health

### ✅ node_modules Present in Both

- `frontend/node_modules/` — installed ✅
- `backend/node_modules/` — installed ✅

### ✅ Frontend Dependencies Are Current

Key packages: React 19.2, Vite 7.2, TypeScript 5.9, Supabase JS 2.91, Zustand 4.5, Tailwind 3.4, Playwright 1.50

### ⚠️ Backend Missing Rate-Limit Package

The backend `package.json` has no `express-rate-limit` dependency. MODULE_STATUS notes "no rate limiting on bid endpoint" — this should be added for Module 08 completeness.

### ⚠️ Backend Uses Express 5 (unstable)

`"express": "^5.2.1"` — Express 5 is RC. The TypeScript error in `server.ts` (`Argument of type '(...) => void' is not assignable to type 'PathParams'`) is a known Express 5 typing regression. The `requestIdMiddleware` call signature needs updating for Express 5's stricter types.

---

## Section 3: Build Verification

### ❌ Frontend TypeScript: 15 Errors

Run from `frontend/` with `npx tsc --noEmit`:

| File | Error | Root Cause |
|------|-------|-----------|
| `features/profile/pages/ProfilePage.tsx:47` | Querying `user_profiles` table | Table doesn't exist — should be `users` |
| `features/profile/pages/ProfilePage.tsx:56-58` | `display_name`, `bio`, `profile_photo_url` not on type | `bio` and `profile_photo_url` don't exist in `users` table |
| `features/profile/pages/ProfilePage.tsx:129` | Upserting to `user_profiles` | Same non-existent table |
| `features/profile/pages/ProfilePage.tsx:198` | `as` prop on `Button` component | `Button` doesn't support polymorphic `as` prop |
| `lib/api/listings.ts:82` | Unused `result` variable | Minor cleanup needed |
| `lib/api/listings.ts:174` | `string` → `listing_status` enum mismatch | Status filtering passes raw string |
| `pages/CreateListing.tsx:91` | `"draft"` vs `"DRAFT"` enum case | Lowercase status doesn't match DB enum |
| `pages/CreateListing.tsx:91` | `seller_id` doesn't exist on listings | The listings table does have `seller_id` — this is a type resolution issue likely caused by wrong Supabase operation chain |
| `pages/Dashboard.tsx:30` | `"active"` vs `"ACTIVE"` enum case | Same lowercase issue |
| `pages/Dashboard.tsx:35` | `current_price` column missing on listings | `current_price` is on `auctions` not `listings` |
| `pages/MyListings.tsx:42` | `current_price` column missing on listings | Same issue |
| `listingCreationStore.ts:148` | `string \| undefined` not assignable to `string` | Missing null guard |
| `listingCreationStore.ts:172` | `type: string` not assignable to `"IMAGE" \| "VIDEO"` | Missing type cast from DB result |
| `listingCreationStore.ts:198` | `string \| undefined` not assignable to `string` | Missing null guard |
| `test/e2e/accessibility.spec.ts:80` | Unused variable | Minor |

**Critical:** `ProfilePage.tsx` is trying to read/write a `user_profiles` table that doesn't exist in the schema. This would cause a 400 runtime error for all profile operations.

### ❌ Backend TypeScript: 12 Errors

Run from `backend/` with `npx tsc --noEmit`:

| File | Error | Root Cause |
|------|-------|-----------|
| `server.ts:16` | Middleware type mismatch | Express 5 breaking change in `app.use()` signature |
| `routes/webhooks.ts:113` | `transactions` table unknown | Backend DB types stale (9 tables vs. 19) |
| `services/payment/BaseProcessor.ts:35` | `calculate_processor_success_rate` RPC unknown | Function exists in frontend DB types but not backend |
| `services/payment/BaseProcessor.ts:45` | `string \| number \| true` not assignable to `number` | Missing type narrowing |
| `services/payment/BaseProcessor.ts:58` | `processor_health` table unknown | Table missing from backend DB types |
| `services/payment/CascadeOrchestrator.ts:173` | `payment_attempts` table unknown | Table missing from backend DB types |
| `services/payment/CascadeOrchestrator.ts:173` | `SIGNATURE` processor not in enum | Backend DB types use stale `SEGPAY` enum |
| `services/payment/CascadeOrchestrator.ts:203` | `transactions` table unknown | Table missing from backend DB types |
| `services/payment/CascadeOrchestrator.ts:226` | `processor_config` table unknown | Table missing from backend DB types |
| `services/payment/CascadeOrchestrator.ts:236` | `enabled` property unknown | Cascades from wrong table query |
| `services/payment/processors/StripeProcessor.ts:71` | `"card"` type mismatch | Stripe SDK type changed |

**Root Cause of Most Backend Errors:** `backend/src/types/database.ts` is **outdated** — it has 9 tables from Module 08 era. The `database.types.ts` in the same directory is **empty** (0 bytes). The frontend's `database.types.ts` (19 tables) is current. The backend needs to be regenerated.

---

## Section 4: Schema Validation

### ❌ CRITICAL: Locked Zod Schemas Import Firebase

**Location:** `functions/src/v1/schemas/domain/common.schema.ts`

```typescript
import { Timestamp } from "firebase-admin/firestore";
export const FirestoreTimestampSchema = z.instanceof(Timestamp);
```

This import is used throughout **all** locked domain schemas. Without the Firebase Admin SDK runtime, these schemas cannot be instantiated. They are **dead code** in the current Supabase architecture.

**Files affected:**
- `common.schema.ts` — imports Firebase directly
- `auction.schema.ts` — uses `FirestoreTimestampSchema`
- `user.schema.ts` — uses `FirestoreTimestampSchema` in 8 fields
- `bid.schema.ts` — uses `FirestoreTimestampSchema`
- `settlement.schema.ts` — likely same

### ❌ CRITICAL: Locked Enum Values Diverged from SQL

| Enum | Locked Zod Value | Actual SQL Value | Verdict |
|------|-----------------|-----------------|---------|
| `ListingStatus` | `"DRAFT", "ACTIVE", "SUSPENDED", "ARCHIVED"` | `'DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'SOLD', 'CANCELLED', 'REMOVED'` | Diverged |
| `AuctionStatus` | `"SCHEDULED", "RUNNING", "CLOSED", "VOIDED"` | `'DRAFT', 'SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED', 'SETTLED'` | Diverged |
| `PaymentProcessor` | `"STRIPE", "SEGPAY"` | `'STRIPE', 'PAYMENTCLOUD', 'SIGNATURE', 'CCBILL', 'NOWPAYMENTS'` | Diverged |
| `ItemCondition` | `"NEW", "LIKE_NEW", "GOOD", "FAIR", "POOR"` | `'NEW', 'LIKE_NEW', 'EXCELLENT', 'GOOD', 'FAIR', 'POOR'` | Missing `EXCELLENT` |

**Impact:** The locked schemas, if used for validation, would reject valid Supabase data. `SEGPAY` was never deployed and doesn't exist in the DB.

### ❌ Backend `database.ts` is 10 Tables Behind

| Present in Backend | Missing from Backend (in Frontend) |
|--------------------|-----------------------------------|
| auctions ✅ | admin_roles ❌ |
| bids ✅ | admin_users ❌ |
| categories ✅ | audit_logs ❌ |
| listing_media ✅ | crypto_payments ❌ |
| listings ✅ | moderation_queue ❌ |
| payments ✅ | payment_attempts ❌ |
| settlements ✅ | processor_config ❌ |
| shipping_addresses ✅ | processor_health ❌ |
| users ✅ | refunds ❌ |
| | transactions ❌ |

**Fix:** Run `npx supabase gen types typescript --project-id pmlofthmobglcfkqjtru > frontend/src/types/database.types.ts && cp frontend/src/types/database.types.ts backend/src/types/database.ts`

### ⚠️ `user_profiles` Table Does Not Exist

The `ProfilePage.tsx` queries `user_profiles` — this table is NOT in the SQL migrations. The `users` table contains `display_name`, `seller_tier`, `is_banned`, `is_suspended`, but does NOT contain `bio` or `profile_photo_url`. Those columns don't exist anywhere in the schema.

### ⚠️ `content_flags` Column Not on `listings`

The `process-payment` Edge Function queries `listings.content_flags`. This column does not appear in the `listings` table definition in the migrations.

### ⚠️ `payment_transactions` Table vs `transactions`

The `process-payment` Edge Function inserts into `payment_transactions`, but the actual table in migrations is `transactions`.

---

## Section 5: Dead Code & Firebase Artifacts

### ❌ Firebase Artifacts Still Present in Project Root

In `unmentionables/Unmen/`:
- `.firebaserc` — Firebase project config (unused)
- `firebase.json` — Firebase deployment config (unused)
- `firebase-debug.log` — 6.6MB log file (should not be committed)
- `firestore-debug.log` — 58KB log file (should not be committed)

### ❌ `functions/` Directory: Firebase Runtime Required

The entire `functions/` directory (locked Modules 01-02) has Firebase as a hard runtime dependency. The locked schemas cannot be imported or used without `firebase-admin`. This directory is dead weight in a pure-Supabase architecture, though the domain logic (auction mechanics) is still valuable.

**Recommendation:** The auction mechanics pure functions (`auction.mechanics.ts`, `auction.proxy.ts`, etc.) should be extracted and ported to a standalone TS module without Firebase dependencies.

### ❌ Orphaned `auctionControllers.ts`

`backend/src/controllers/auctionControllers.ts` — 46-line simplified version, not imported anywhere. The correct file (`auctionController.ts`, 88 lines) is imported by routes.

### ❌ Three Copies of `authStore.ts`

| Path | Lines | Imported By |
|------|-------|-------------|
| `features/auth/store/authStore.ts` | 134 | `useAuth.ts` ✅ (canonical) |
| `stores/authStore.ts` | 134 | Nothing ❌ |
| `features/auth/components/authStore.ts` | 128 | Nothing ❌ |

Two orphaned copies should be deleted.

### ❌ Nested `supabase/functions/supabase/` Directory

`supabase/functions/supabase/` exists (an accidental nested supabase init). It contains a `.temp/` directory and `supabase/functions/` inside it. This is an artifact of a misrun `supabase init` inside the functions directory.

### ⚠️ Backend Has Duplicate Payment Service vs Edge Functions

The backend has `backend/src/services/payment/` (for Express-based payments) AND `supabase/functions/_shared/payment/` (the actual deployed Edge Functions). Per MODULE_STATUS, payments moved to Edge Functions, making the Express payment service layer potentially dead:
- `backend/src/services/payment/CascadeOrchestrator.ts` — 249 lines, TS errors, not used in production
- `backend/src/services/payment/processors/` — Both `StripeProcessor.ts` and `PaymentCloudProcessor.ts` — not the deployed processors

The backend's `payments.ts` route and `paymentController.ts` reference these and the `transactions` table. These may need to be either removed or updated to proxy to Edge Functions.

---

## Section 6: Module Completeness

### Module 01 — Core Domain Models
- **Claimed:** PRODUCTION READY, FROZEN ✅
- **Reality:** ⚠️ Schemas import Firebase — non-functional without Firebase runtime. Domain logic (auction mechanics) is valid TypeScript, but Zod schemas can't instantiate `FirestoreTimestampSchema`. The schemas work as type definitions but fail validation at runtime.

### Module 02 — Auction Mechanics
- **Claimed:** PRODUCTION READY, FROZEN ✅
- **Reality:** ✅ Pure functions (`auction.mechanics.ts`, `auction.proxy.ts`, `auction.invariants.ts`) are valid and don't depend on Firebase directly. The test runner exists. Logic is sound.

### Module 03 — Authentication
- **Claimed:** PRODUCTION READY ✅
- **Reality:** ✅ Login, Signup pages exist. Auth store (canonical copy). `useAuth` hook. `ProtectedRoute`. Supabase auth integration. Missing: `ForgotPasswordPage.tsx` exists but has **no route in App.tsx**.

### Module 04 — User Profiles
- **Claimed:** PRODUCTION READY (100% test pass) ✅
- **Reality:** ❌ `ProfilePage.tsx` queries non-existent `user_profiles` table. `bio` and `profile_photo_url` columns don't exist in the schema. This module has a **breaking runtime bug**. The component files in `features/profile/components/` appear well-built (ProfileHeader, ProfileEditForm, ShippingAddressForm, etc.) but the page-level component is broken.

### Module 05 — Listing Management
- **Claimed:** PRODUCTION READY ✅
- **Reality:** ⚠️ 7-step wizard exists. TypeScript errors in `CreateListing.tsx` (lowercase enum `"draft"`) and `listingCreationStore.ts` (type mismatches). Functional but won't compile cleanly.

### Module 06 — Browse & Search
- **Claimed:** PRODUCTION READY ✅
- **Reality:** ❌ **No browse or search route in `App.tsx`**. `CategoryBrowser.tsx` exists as a wizard step component, not a browse page. There is no `BrowsePage.tsx`, no search results page, no search bar in the header. The module appears to have been partially built (category filtering inside listing creation) but the public browse/search UI is missing.

### Module 07 — Design System
- **Claimed:** PRODUCTION READY ✅
- **Reality:** ✅ Components exist: `Button`, `Input`, `Modal`, `ErrorBoundary`, `SellerTierBadge`, accessibility tests. Header component present. Minor issue: `Button` lacks `as` prop (causes TS error in ProfilePage).

### Module 08 — Auction Mechanics Frontend + Backend
- **Claimed:** PRODUCTION READY (pending settlement) ✅
- **Reality:** ✅ `AuctionDetailPage`, `BidHistory`, `BidPlacementForm`, `CountdownTimer`, `CurrentBidDisplay`. Hooks: `useAuction`, `useBidHistory`, `useCountdown`, `usePlaceBid`. Backend routes exist. Known gaps noted in status are accurate.

### Module 09 — Payment Cascade System
- **Claimed:** ARCHITECTURALLY COMPLETE, DEPLOYED, AWAITING API KEYS ⚠️
- **Reality:** ⚠️ Edge Functions exist with all 5 processors implemented. **Critical issues:**
  1. `process-payment/index.ts` has hardcoded `mockUserId` for "LOCAL TEST MODE" — must be removed before production
  2. Inserts to `payment_transactions` table (should be `transactions`)
  3. Queries `listings.content_flags` (column doesn't exist in schema)
  4. Queries `listings.current_price` (column doesn't exist in schema — it's `current_price_cents` on auctions)
  5. Backend `CascadeOrchestrator.ts` uses stale DB types and wrong processor enum

### Module 10 — Admin Dashboard Backend
- **Claimed:** BACKEND COMPLETE, FRONTEND PENDING ✅
- **Reality:** ✅ Backend verified: `adminAuth.ts`, `adminRateLimit.ts`, `auditLog.ts` middleware. Routes: users, moderation, audit-logs. All 6 endpoints tested. Frontend: confirmed not started.

---

## Section 7: Environment Files

### ✅ `.env` Files Not Committed to Git

Git history shows no commits of `.env` files. `.gitignore` correctly excludes `.env` and `.env.*`.

### ⚠️ Service Role Key in Local `backend/.env`

`SUPABASE_SERVICE_ROLE_KEY=sb_secret_uOUktG_...` is in `backend/.env`. Not committed, but present locally. This key has full database access bypassing RLS — treat as a production secret, rotate if it has appeared in any shared context.

### ❌ Frontend `.env` Has Formatting Error

```
VITE_AWS_REGION=us-east-1VITE_API_URL=http://localhost:3001/api/v1
```
The `VITE_API_URL` is concatenated with the previous line (missing newline). `VITE_API_URL` is not set as a result.

### ⚠️ Frontend `.env.example` Contains Backend Vars

The frontend `.env.example` includes backend-only variables like `STRIPE_SECRET_KEY`, `PAYMENTCLOUD_SECURITY_KEY`, etc. These should only be in `backend/.env.example`.

### ✅ All Required Env Vars Documented

Both `.env.example` files together cover all required variables. The Supabase edge function env vars need a separate `supabase/.env.local` (not checked).

---

## Section 8: Security Findings

### ❌ Hardcoded Mock User in Production Edge Function

`supabase/functions/process-payment/index.ts:20`:
```typescript
const mockUserId = '2e6c5e9d-5fd4-4c14-8b3f-909e21986b72';
```
Auth is skipped: `// TEMP: Skip auth for local testing`. This function is deployed — any call to it processes payments as that hardcoded user. **This must be fixed before any payment testing in production.**

### ⚠️ Singleton Supabase Service-Role Client in Admin Auth

`adminAuth.ts` creates a singleton `supabaseService` client with the service role key at module load. This is shared across all requests. While acceptable for the admin middleware (read-only `admin_users` check), it means any downstream code using this client bypasses RLS for all operations.

### ✅ Zero-Trust Admin Session Validation

The admin auth implementation correctly validates JWT + admin_users record + session version for revocation. Solid implementation.

### ✅ `.env` Files Not in Git History

Confirmed — no secrets committed.

---

## Section 9: Identified Gaps Not in MODULE_STATUS.md

1. **No public home/browse page** — root redirects to `/my-listings`. There is no landing page, browse page, or search results page. Module 06 is incomplete despite being claimed as PRODUCTION READY.

2. **`/signup` route is actually `/register`** — CLAUDE.md documents the signup route as `/signup`, but `App.tsx` uses `/register`. The `SignupPage` component exists.

3. **`/forgot-password` route missing** — `ForgotPasswordPage.tsx` exists but is not routed.

4. **No navigation header on authenticated pages** — `Header.tsx` component exists but is not included in `App.tsx` or any layout wrapper.

5. **`Dashboard.tsx` queries `current_price` on listings** — listings don't have `current_price`. This page would show no data.

6. **Backend payment service vs Edge Functions confusion** — The backend routes (`/api/v1/payments/`) and controller (`paymentController.ts`) still reference `transactions` table and use the Express-based `CascadeOrchestrator`. But the architecture moved payments to Edge Functions. It's unclear if these Express endpoints should proxy to Edge Functions or be removed.

7. **`functions/` lacks its own `tsconfig.json`** — The locked modules directory has `package.json` but `tsconfig.json` may be missing (not verified). These Firebase-era files have never been type-checked against the current project.

8. **Fee calculation inconsistency** — `paymentController.ts` uses: TIER_1=15%, TIER_2=10%, TIER_3=5%. CLAUDE.md documents: TIER_1=20%, TIER_2=17.5%, TIER_3=15%. SQL function `calculate_platform_fee_percent` matches CLAUDE.md. The backend controller has wrong fee percentages.

---

## Section 10: Recommended Next Steps (Prioritized by Impact)

### 🔴 CRITICAL — Fix Before Any Further Development

1. **Regenerate backend database types**
   ```bash
   npx supabase gen types typescript --project-id pmlofthmobglcfkqjtru > frontend/src/types/database.types.ts
   cp frontend/src/types/database.types.ts backend/src/types/database.ts
   ```
   This fixes ~10 backend TS errors and unblocks payment/webhook routes.

2. **Fix `process-payment` Edge Function** — Remove hardcoded mockUserId, add real auth, fix table names (`payment_transactions` → `transactions`), fix column names (`content_flags`, `current_price`).

3. **Fix `ProfilePage.tsx`** — Rewrite to query `users` table instead of non-existent `user_profiles`. Decide whether `bio`/`profile_photo_url` columns need to be added to the `users` table via migration.

4. **Fix frontend enum case mismatches** — `"draft"` → `"DRAFT"`, `"active"` → `"ACTIVE"` in `Dashboard.tsx` and `CreateListing.tsx`.

### 🟠 HIGH — Fix in Next Session

5. **Fix `current_price` on `Dashboard.tsx` and `MyListings.tsx`** — These pages query `current_price` on listings. Either join to `auctions` or remove the field from the query.

6. **Update CLAUDE.md to reflect actual project root** — All path references in CLAUDE.md are wrong. Add a note that the actual project is at `unmentionables/Unmen/`.

7. **Fix `frontend/.env` formatting** — Add missing newline before `VITE_API_URL`.

8. **Delete orphaned files:**
   - `backend/src/controllers/auctionControllers.ts` (unused duplicate)
   - `frontend/src/stores/authStore.ts` (unused copy)
   - `frontend/src/features/auth/components/authStore.ts` (misplaced unused copy)
   - `supabase/functions/supabase/` (accidental nested directory)

### 🟡 MEDIUM — Address for Module Completeness

9. **Add `/forgot-password` route to `App.tsx`** — Component exists, just needs routing.

10. **Clarify Module 06 status** — Browse/search has no routes, no page components. Either build the missing UI or downgrade status in MODULE_STATUS.md.

11. **Add `Header` component to App layout** — Navigation is built but not connected.

12. **Fix fee percentages in `paymentController.ts`** — Should match CLAUDE.md business rules (20%/17.5%/15%), not current hardcoded values (15%/10%/5%).

13. **Clarify Express payment routes** — Either remove `backend/src/routes/payments.ts` and `paymentController.ts` (payments are Edge Functions), or document that they're kept as a fallback proxy.

### 🟢 LOW — Technical Debt Cleanup

14. **Firebase artifact cleanup:**
    - Remove `.firebaserc`, `firebase.json`, `firebase-debug.log`, `firestore-debug.log`
    - Update `.gitignore` to remove Firebase references

15. **Port `functions/` auction mechanics away from Firebase** — The pure auction logic (`auction.mechanics.ts`, `auction.proxy.ts`) is valuable. Extract it into a standalone package or move it to `backend/src/lib/auction/` with proper Supabase timestamp types.

16. **Merge top-level `docs/` with `unmentionables/Unmen/docs/`** — Eliminate docs split.

17. **Fix Express 5 middleware typing in `server.ts`** — Cast `requestIdMiddleware` correctly for Express 5's updated `app.use()` signature.

18. **Add `express-rate-limit` to backend** — Required for Module 08 completeness (bid endpoint rate limiting).

---

## Appendix: File Count Summary

| Location | TS/TSX Files | SQL Files |
|----------|-------------|-----------|
| `frontend/src/` | ~85 | 0 |
| `backend/src/` | ~25 | 0 |
| `supabase/functions/` | ~18 | 0 |
| `functions/src/v1/` (locked) | ~55 | 0 |
| `supabase/migrations/` | 0 | 3 |
| **Total** | **~183** | **3** |

## Appendix: Database Tables (19 total in production)

From migrations: `auctions`, `bids`, `categories`, `crypto_payments`, `listing_media`, `listings`, `payment_attempts`, `payments`, `processor_config`, `processor_health`, `refunds`, `settlements`, `shipping_addresses`, `transactions`, `users`, `admin_roles`, `admin_users`, `moderation_queue`, `audit_logs`

---

*Report generated: 2026-02-28. Audit took approximately 45 minutes of automated analysis.*
