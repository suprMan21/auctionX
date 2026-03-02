# Module 12: Seller Payouts — Verification Report

**Date:** 2026-03-01
**Branch:** dev
**Status:** Implementation complete

---

## Build Status

| Check | Result |
|-------|--------|
| `frontend npx tsc --noEmit` | ✅ 0 errors |
| `backend npx tsc --noEmit` | ✅ 0 errors |
| `frontend npm run build` | ✅ PASS |

---

## Files Created

| File | Purpose |
|------|---------|
| `supabase/migrations/20260301000002_payouts_table.sql` | Escrow columns on settlements + payouts table |
| `supabase/functions/_shared/payment/payoutCalculation.ts` | Fee calculation utility |
| `supabase/functions/release-escrow/index.ts` | Cron-triggered escrow release edge function |
| `frontend/src/features/payouts/types/payout.ts` | Payout TypeScript interfaces |
| `frontend/src/pages/PayoutsPage.tsx` | Seller payout dashboard |
| `backend/src/controllers/payoutController.ts` | listPayouts + openDispute handlers |
| `backend/src/routes/payouts.ts` | GET /api/v1/payouts |
| `backend/src/routes/admin/disputes.ts` | Admin dispute stubs (501) |
| `backend/src/lib/notifications/stubs.ts` | Notification stubs (Module 16 placeholder) |
| `docs/MODULE_12_VERIFICATION.md` | This file |

---

## Files Modified

| File | Change |
|------|--------|
| `supabase/functions/payment-webhook/index.ts` | Added `escrow_ends_at` (+72h) when settlement transitions to ESCROW_HOLD |
| `frontend/src/lib/api.ts` | Added `getPayouts()`, `openDispute()` |
| `frontend/src/pages/SettlementPage.tsx` | RELEASED/DISPUTED status colors; dispute form (buyer); dispute alert (seller) |
| `frontend/src/features/auctions/types/settlement.ts` | Added RELEASED, DISPUTED to SettlementStatus; added escrow/dispute fields |
| `frontend/src/App.tsx` | Added `/payouts` protected route |
| `frontend/src/components/navigation/Header.tsx` | Added "Payouts" nav link |
| `backend/src/routes/settlements.ts` | Added POST /:id/dispute route |
| `backend/src/routes/admin/index.ts` | Mounted disputesRouter at /disputes |
| `backend/src/server.ts` | Mounted payoutRoutes at /api/v1/payouts |

---

## Routes Added

### Frontend
| Route | Component | Protection |
|-------|-----------|------------|
| `/payouts` | `PayoutsPage` | ProtectedRoute (auth required) |

### Backend API
| Method | Path | Handler | Auth |
|--------|------|---------|------|
| GET | `/api/v1/payouts` | `listPayouts` | requireAuth |
| POST | `/api/v1/settlements/:id/dispute` | `openDispute` | requireAuth (buyer only) |
| POST | `/api/v1/admin/disputes/:id/approve` | stub 501 | admin |
| POST | `/api/v1/admin/disputes/:id/reject` | stub 501 | admin |

### Edge Functions
| Function | Trigger | Auth |
|----------|---------|------|
| `release-escrow` | Cron / manual POST | `x-release-secret` header |

---

## Manual Test Checklist

- [ ] Apply migration: `npx supabase db push` (from `unmentionables/Unmen/`)
- [ ] Regen types: `npx supabase gen types typescript --project-id pmlofthmobglcfkqjtru > frontend/src/types/database.types.ts && cp frontend/src/types/database.types.ts backend/src/types/database.types.ts`
- [ ] Remove `(supabase as any)` cast in `PayoutsPage.tsx` after type regen
- [ ] Verify `escrow_ends_at` is set on settlement when payment webhook fires
- [ ] Deploy `release-escrow` edge function
- [ ] Set `RELEASE_ESCROW_SECRET` env var (must match in both scheduler and edge function)
- [ ] Navigate to `/payouts` — shows empty state for new seller
- [ ] Verify RELEASED/DISPUTED status badges on `/settlements/:id`
- [ ] Verify dispute form only shows for buyer on ESCROW_HOLD settlement
- [ ] Verify seller sees dispute alert and reason when status is DISPUTED
- [ ] Admin stub endpoints return 501

---

## Known Gaps / Deferred Work

- `payouts` table not yet in `database.types.ts` — requires migration apply + type regen
- `PayoutsPage.tsx` uses `(supabase as any)` cast until types are regenerated
- `release-escrow` marks payout PROCESSING but no actual Stripe Connect Transfer is made
- Admin dispute approval/rejection are 501 stubs — full flow deferred to Module 13+
- Notification stubs (console.log only) — real impl in Module 16
- pg_cron schedule for `release-escrow` not yet configured
- `RELEASE_ESCROW_SECRET` env var not yet added to edge function config

---

## Spec Bugs Fixed

| Location | Spec Said | Correct |
|----------|-----------|---------|
| `release-escrow` query | `t.status = 'COMPLETED'` | `t.status = 'SUCCEEDED'` |
| `PayoutsPage` query | `settlements(listing_id, listings(title))` | `settlements(auction_id, auctions(listing_id, listings(title)))` |
| (omitted in spec) | No mention of `escrow_ends_at` gap | `payment-webhook` must set it on ESCROW_HOLD transition |
