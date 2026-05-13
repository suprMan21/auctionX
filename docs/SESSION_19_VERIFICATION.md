# Session 19: Real-Buyer Marketplace Loop (Part 1) — Verification Report

**Date:** 2026-05-13
**Session:** 19 — wire the three frontend stubs that forced session 18 to fall back on curl + SQL.
**Status:** ✅ Code complete + deployed to staging. ⏳ Browser E2E pending Boss interaction. ⏳ Stripe payment-webhook still needs to be registered in the Stripe Dashboard.
**Branch:** `feature/phase-7e-real-buyer-loop`

---

## Goals (from plan)

1. Buyer can click **Place Bid** on a real auction page and submit a bid through the UI.
2. Buyer can click **Confirm Delivery** on `/settlements/:id` and trigger the release-escrow tick.
3. Stripe automatically transitions `PENDING_PAYMENT → ESCROW_HOLD` via the registered `payment-webhook` endpoint on the next test charge (no SQL workaround needed).

Stripe Elements / Pay Now button — **deferred to session 20** per Boss decision (the remaining stub).

---

## Build Status

| Check | Status |
|-------|--------|
| `frontend npx tsc --noEmit` | ✅ 0 errors |
| `backend  npx tsc --noEmit` | ✅ 0 errors |
| `frontend npm run build` | ✅ Bundle `index-C9jdJ9Hm.js` (819 KB / 218 KB gzip) |
| Staging deploy: `aws s3 sync` | ✅ Synced |
| CloudFront invalidation | ✅ `IDDIGPC1KN01ILP2Z7CDGALCIC` |
| Deployed bundle hash live on `d1bwev65w7rqzl.cloudfront.net` | ✅ `index-C9jdJ9Hm.js` |
| Backend health (App Runner) | ✅ `{"status":"healthy"}` |

---

## Files Modified

| File | Change |
|------|--------|
| `frontend/src/types/database.types.ts` + `backend/src/types/database.types.ts` | Regenerated against prod schema. Added `delivery_confirmed_at` + `delivery_confirmed_by` on `settlements`. |
| `frontend/src/features/auctions/types/settlement.ts` | Added `delivery_confirmed_at` + `delivery_confirmed_by` to the `Settlement` interface. |
| `frontend/src/lib/api.ts` | New `api.confirmDelivery(settlementId)` helper. Returns `{settlementId, deliveryConfirmedAt, deliveryConfirmedBy, status}`. |
| `frontend/src/lib/api/listings.ts` | `listingsApi.getById` now joins `auctions(*)` (was previously only `listing_media + users`). One-call replacement for separate auction fetch. |
| `frontend/src/pages/SettlementPage.tsx` | BuyerView gains a `Confirm Delivery` card (emerald, visible when status=`ESCROW_HOLD` AND `!delivery_confirmed_at`). `window.confirm` guard before submit, idempotent backend = safe re-clicks. On success: optimistic update via `onDeliveryConfirmed(at, by)` callback to parent + toast. After confirmation, Open-Dispute card is hidden. |
| `frontend/src/pages/ViewListing.tsx` | Place Bid button replaced with auth/seller/status-aware behavior: logged-out → `Sign in to bid` → `/login?return=/listings/:id`; seller → `View Auction →` link; auction ended → disabled `Auction ended` chip; active + buyer → `Place Bid →` link to `/auctions/:auctionId`. Current bid + reserve indicator + `CountdownTimer` added above the button. |

## Files NOT Created

The plan called for a new `BidModal.tsx` component. **Discovered during implementation that a full bid flow already exists** at `/auctions/:id` (`AuctionDetailPage` + `BidPlacementForm` + `useAuction` + `BidHistory` + `CurrentBidDisplay`). Building a parallel modal would duplicate this and strip context (bid history, countdown). Pivoted to **navigation** instead — the Place Bid button on a listing routes the buyer to the existing auction page, which contains the bid form. Zero new components needed.

---

## Manual Smoke Test (browser, on staging)

Pre-reqs:
- Logged in as `test@authentic-materials.com` (test buyer) or `chris.lafleche@cravingcorp.com` (admin/seller).
- Have a recent ACTIVE listing with `auction.status='ACTIVE'`.

### Place Bid path (no auth → auth → bid)

1. Logged out, hit `https://d1bwev65w7rqzl.cloudfront.net/listings/{listingId}`. Verify Place Bid renders the gradient `Sign in to bid` link → clicking lands on `/login` (with `?return=/listings/:id` in URL).
2. Log in as test buyer. Return to the listing. Verify button reads `Place Bid →` and the current bid + reserve indicator + countdown are visible above it.
3. Click Place Bid → routed to `/auctions/:auctionId`. Verify current bid display + bid history render, and the BidPlacementForm is mounted in the right rail.
4. Fill in an amount ≥ minimum next bid, submit. Verify success state in the form, then check the auction current_price_cents updated.
5. Open the same listing as the seller (admin account). Verify the button reads `View Auction →` (no bidding).
6. Force-end the auction via SQL (`UPDATE auctions SET status='ENDED', end_time=NOW()-INTERVAL '1 second' WHERE id=...`). Verify the button becomes a disabled `Auction ended` chip.

### Confirm Delivery path

7. With a settlement in `ESCROW_HOLD` (one will exist after the full E2E below), navigate to `/settlements/:settlementId` as the buyer. Verify the new emerald `Confirm Delivery` card renders below `Payment Received`. The Open-Dispute card should also be visible.
8. Click `Confirm Delivery`. Browser confirm dialog appears with the disclosure. Click OK.
9. Verify toast "Delivery confirmed — funds will release within 15 minutes." The card switches to `Delivery Confirmed` with the timestamp. The Open-Dispute card disappears.
10. Refresh the page. The confirmed state persists (idempotency of the backend already ensures this; re-clicks during the same session are no-ops).

---

## End-to-End Verification (with Stripe webhook registered)

**Pre-req:** Stripe `payment-webhook` registered in Stripe Dashboard (see next section). The remaining manual SQL UPDATE from session 18 (`settlements.status PENDING_PAYMENT → ESCROW_HOLD`) becomes automatic.

Flow:

1. Clean up session-18 fixture per `MODULE_7D_VERIFICATION.md` "Cleanup SQL" block. (Optional — clean fixture or new fixture.)
2. Create a NEW test listing via the Create Listing UI on staging as Chris admin. Confirm an `auctions` row is created and linked.
3. As test buyer in a separate browser: navigate to the listing → click Place Bid → bid via the UI on `/auctions/:id` → verify `bids` row inserted + `auction.current_price_cents` updated. **(replaces session-18 synthetic INSERT)**
4. SQL: `UPDATE auctions SET status='ENDED', end_time=NOW()-INTERVAL '1 second' WHERE id=...` (no UI for ending auctions — pre-existing gap).
5. Curl settle-auction (session-18 pattern, reuses synced `SETTLE_SECRET`). Confirm settlement row created with `status='PENDING_PAYMENT'`.
6. Curl process-payment with `pm_card_visa` (session-18 pattern). Confirm `transactions.status='SUCCEEDED'` **AND the registered Stripe webhook auto-flips `settlement.status='ESCROW_HOLD'`** within ~5-10 seconds. **(replaces session-18 manual SQL UPDATE)**
7. As test buyer: navigate to `/settlements/:settlementId` → click **Confirm Delivery** → verify `delivery_confirmed_at` populated. **(replaces session-18 manual SQL UPDATE)**
8. Wait for next release-escrow cron tick (≤15 min) OR fire `SELECT net.http_post(...)` manually. Verify `settlement.status='RELEASED'`, payouts row populated with `stripe_transfer_id`, **and fresh Postmark email arrives at buyer + seller addresses**.

If any step fails, fall back to the session-18 SQL workaround and log the failure as a follow-up.

---

## Stripe Payment-Webhook Registration (Boss — one-time, ~5 min)

This is a Stripe Dashboard task, not a code change. Required to close the last synthetic SQL step.

1. Stripe Dashboard → **Developers → Webhooks → Add endpoint** (account-level, NOT the Connect endpoint already registered for Phase 7D).
2. URL: `https://pmlofthmobglcfkqjtru.supabase.co/functions/v1/payment-webhook`
3. Subscribe to events: `payment_intent.succeeded`, `payment_intent.payment_failed`.
4. Stripe will assign a new signing secret. Copy it.
5. Update `op://AM_Development/Stripe/webhook-secret` in 1Password with the new value.
6. Push the new secret to the Supabase Edge Function env:
   ```bash
   supabase secrets set STRIPE_WEBHOOK_SECRET="$(op read 'op://AM_Development/Stripe/webhook-secret')" --project-ref pmlofthmobglcfkqjtru
   ```
7. Sanity check: the deployed `payment-webhook` function already uses `constructEventAsync` (verified at `supabase/functions/_shared/payment/processors/StripeProcessor.ts:156` — Lesson #2 satisfied).
8. Send a test event from Stripe Dashboard ("Send test webhook") and confirm a `200 OK` response.

After this, the synthetic `UPDATE settlements SET status='ESCROW_HOLD'` from session 18 is no longer needed.

---

## Architectural Notes / Design Calls

- **`listingsApi.getById` now joins `auctions(*)`.** ViewListing was the only caller. Avoids a separate fetch + simplifies the buyer's loading state. If future callers don't need the auction join, splitting back out is a one-line change.
- **Place Bid → navigation, not modal.** Buyer needs price + history + countdown to decide; a modal would hide all that. Reuses the already-shipped `BidPlacementForm` + `AuctionDetailPage` flow.
- **Optimistic UI on Confirm Delivery.** Parent state update fires immediately on success. Realtime subscription on `settlements` (existing, `SettlementPage.tsx:317-334`) catches up when the server-side UPDATE replicates. Backend is idempotent so double-clicks are safe.
- **`window.confirm` guard.** Used `window.confirm` (native dialog) for the "Are you sure?" check rather than a custom modal — the friction step is the goal, not the styling. If future UX wants a styled modal, the swap is trivial.
- **Idempotent confirm-delivery endpoint already records `delivery_confirmed_by`.** Surfacing it in BuyerView (audit trail for the buyer's record) was elided — only `at` is shown. Trivial follow-up if needed.

---

## Out of Scope (intentional)

- **Stripe Elements / Pay Now wire-up** — session 20. Pay Now button keeps existing `alert()` stub.
- **"My Purchases" list page** — buyer accesses settlement by direct URL or notification link. List page is a UX nice-to-have.
- **Auction-end UI** — still SQL-only; the cron `pg_cron` auto-close pattern is a separate item.
- **Settle-secret in `vault.secrets`** — separately tracked follow-up.
- **Styled "Are you sure?" modal** — `window.confirm` is sufficient today.
- **`return` query param handling on `/login`** — link is plumbed; LoginPage handler is a follow-up.

---

## Risks / Known Gaps

1. **Until Boss registers the Stripe payment-webhook, the synthetic SQL UPDATE from session 18 is still required.** End-to-end without registration only flips state via the manual SQL pattern.
2. **No unit tests added.** Bidding logic was untouched (reuses tested `BidPlacementForm`); confirm-delivery is a thin pass-through to a tested backend.
3. **`window.confirm` is a native dialog.** Cannot be styled. Acceptable for now.
4. **Auctions join in `listingsApi.getById` returns array.** Supabase returns `auctions: [...]` for to-many relationships; the code handles both array and single-object shapes defensively.

---

## Follow-ups (Session 20 candidates)

- Stripe Elements / Payment Element on SettlementPage (the remaining stub). Requires `op://AM_Development/Stripe/publishable-key` to be populated first.
- Buyer-facing "My Purchases" list page.
- Auction-end UI (currently SQL-only).
- `frontend/src/pages/ViewListing.tsx` is still 200+ lines of `any` types — a typed refactor pass is overdue.
- Stash `settle_secret` in `vault.secrets` for cron-style invocation parity.
- Build a "styled confirm" modal helper that wraps `window.confirm` semantics with project styling, then swap into `handleConfirmDelivery` + reuse elsewhere.
