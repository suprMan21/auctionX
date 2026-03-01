# Phase 0 Changes — Audit & Repair (Passes 1–3)

**Date:** 2026-02-28 → 2026-03-01
**Branch:** dev
**Build status after Phase 0:** ✅ Frontend 0 errors | ✅ Backend 0 errors | ✅ Production build PASS

---

## Overview

Phase 0 was a three-pass audit-and-repair cycle run before iterative feature development. The goal was to achieve a clean, compiling, security-sound baseline.

---

## Pass 1 — Foundation Repair

### Files Deleted
- `frontend/src/stores/authStore.ts` — orphaned duplicate auth store
- `frontend/src/features/auth/components/authStore.ts` — second orphaned duplicate
- `backend/src/controllers/auctionControllers.ts` — dead controller (never wired)
- `supabase/functions/supabase/` — incorrectly nested Supabase directory

### Files Modified
- `frontend/src/types/database.types.ts` — regenerated via `supabase gen types` (19 tables, was stale)
- `backend/src/types/database.types.ts` — synced from frontend (was stale)
- `backend/src/types/database.ts` — re-exports from `database.types.ts` (was stale re-export)
- `frontend/.env` — fixed missing newline between VITE_AWS_REGION and VITE_API_URL
- `CLAUDE.md` — corrected project paths and cp command

### Baseline TypeScript error counts
- Frontend: 24 errors (before Pass 1)
- Backend: 31 errors (before Pass 1)

---

## Pass 2 — TypeScript Error Elimination

### Files Modified (Frontend)
- `frontend/src/App.tsx` — wired missing routes, removed ProfilePage reference to nonexistent user_profiles table
- `frontend/src/features/profile/pages/ProfilePage.tsx` — complete rewrite to query `users` table with correct columns
- `frontend/src/features/dashboard/pages/Dashboard.tsx` — fixed enum case "draft" → "DRAFT", "active" → "ACTIVE"
- `frontend/src/features/listings/pages/CreateListing.tsx` — fixed enum case mismatches
- `frontend/src/lib/api.ts` — updated API client for correct response shapes

### Files Modified (Backend)
- `backend/src/routes/auctions.ts` — fixed Express 5 typing (req.params, req.body typing)
- `backend/src/routes/admin/*.ts` — fixed Express 5 handler typing
- `backend/src/middleware/adminAuth.ts` — fixed Express 5 middleware typing
- `backend/src/routes/webhooks.ts` — fixed `transactions` table reference (was stale type)

### Migrations Created
- `supabase/migrations/20260219000001_admin_zero_trust.sql` — admin RLS policies

### TypeScript error counts after Pass 2
- Frontend: **0 errors** ✅
- Backend: **0 errors** (excluding payment files targeted for deletion in Pass 3) ✅

---

## Pass 3 — Security & Payment Cleanup

### Security Fix (CRITICAL)
**`supabase/functions/process-payment/index.ts`** — complete rewrite:
- **Removed hardcoded `mockUserId`** — was processing payments as a specific user (security hole)
- **Removed "TEMP: Skip auth for local testing"** bypass
- **Added real JWT auth** using `SUPABASE_ANON_KEY` + `Authorization` header (matches `place-bid` pattern)
- **Fixed listings query** — removed nonexistent `content_flags` and `current_price` columns from `listings`
- **Added auction join** — queries `auctions.current_price_cents` via `listing_id` FK
- **Fixed table name** — `payment_transactions` → `transactions`
- **Fixed transaction insert columns** to match actual schema:
  - `transaction_id` → `id`
  - `listing_id` → `auction_id`
  - `amount` → `amount_cents`
  - `processor_type` → `successful_processor`
  - `processor_response` → `metadata`
  - Added required fields: `platform_fee_cents`, `seller_payout_cents`, `risk_level`, `payment_window_expires_at`, `content_flags`
- **Added fee calculation** from seller's `seller_tier` (TIER_1: 20%, TIER_2: 17.5%, TIER_3: 15%)
- **Added payment window expiry** (card: 20 min, crypto: 72 hours)
- Content flags now come from `paymentRequest.metadata.contentFlags` (client-provided, not DB column)

### Files Deleted (Express payment dead code)
- `backend/src/routes/payments.ts`
- `backend/src/controllers/paymentController.ts`
- `backend/src/services/payment/CascadeOrchestrator.ts`
- `backend/src/services/payment/BaseProcessor.ts`
- `backend/src/services/payment/ProcessorFactory.ts`
- `backend/src/services/payment/types.ts`
- `backend/src/services/payment/processors/StripeProcessor.ts`
- `backend/src/services/payment/processors/PaymentCloudProcessor.ts`
- `backend/src/services/payment/` — directory removed

### Files Modified
- `backend/src/server.ts` — removed payment route registration and log lines
- `supabase/functions/payment-webhook/index.ts` — fixed two `payment_transactions` → `transactions` references, fixed column names (`transaction_id`→`id`, `listing_id`→`auction_id`, `amount`→`amount_cents`, `processor_response`→`metadata`), added auction lookup to resolve `listing_id`

### Fee Verification
- `frontend/src/components/listings/steps/PricingStep.tsx` — fees confirmed correct (20%/17.5%/15%)
- Incorrect fees (15%/10%/5%) in deleted `paymentController.ts` are gone with the file

---

## Known Remaining Issues (not in Phase 0 scope)

1. **Module 06 (Browse/Search)** — no routes or pages despite "PRODUCTION READY" status in docs
2. **`ForgotPasswordPage.tsx`** — exists but has no route in `App.tsx`
3. **Schema drift** — locked Zod schemas in `functions/src/v1/schemas/domain/` reference `firebase-admin` (non-functional without Firebase runtime); enum values diverged from SQL
4. **process-payment not deployed** — security fix complete but deployment requires env vars and QA
5. **Fee tier lookup** — currently defaults to TIER_1 if seller fetch fails; could be optimized to use DB function `calculate_platform_fee_percent`

---

## Commit History

```
2e01e73  fix: Pass 3 — security fix, delete Express payments, Edge Function cleanup
9608df4  fix: Pass 2 — zero TS errors (frontend), Express 5 typing, ProfilePage rewrite, migration
aa98464  ✅ Module 07: Design System & Accessibility - WCAG 2.2 AA Compliant
```
