# AuctionX — TODO Tracker

Last updated: 2026-03-01 (Module 12 added)

---

## Module 12: Seller Payouts

- [ ] **TODO:** Apply DB migration and regenerate types
  - Context: `supabase/migrations/20260301000002_payouts_table.sql` adds `payouts` table + escrow/dispute columns on settlements. After applying, run `npx supabase gen types typescript --project-id pmlofthmobglcfkqjtru > frontend/src/types/database.types.ts && cp ...`. Then remove `(supabase as any)` cast in `PayoutsPage.tsx`.
  - Priority: HIGH — required before payouts feature works
  - Depends on: Supabase CLI + project credentials

- [ ] **TODO:** Set up pg_cron for release-escrow (every 5 min)
  - Context: `supabase/functions/release-escrow/index.ts` is a cron-style function that finds expired ESCROW_HOLD settlements. Needs pg_cron + pg_net enabled in Supabase, or an external scheduler (e.g. Vercel cron). Call via POST with `x-release-secret` header.
  - Priority: HIGH — without this, escrow is never released automatically
  - Depends on: `RELEASE_ESCROW_SECRET` env var configured in Supabase edge function settings

- [ ] **TODO:** Implement actual Stripe Connect Transfer in release-escrow
  - Context: `release-escrow` creates a payout record and marks it PROCESSING but doesn't call Stripe's Transfer API. Requires seller's Stripe Connect account ID stored on their user profile.
  - Priority: HIGH — payouts currently never actually reach sellers
  - Depends on: Stripe Connect onboarding flow (future module)

- [ ] **TODO:** Implement admin dispute resolution (approve → refund, reject → release)
  - Context: `POST /api/v1/admin/disputes/:id/approve` and `reject` return 501. Approval should trigger buyer refund via Stripe; rejection should call release-escrow logic for the specific settlement.
  - Priority: HIGH — disputed settlements are stuck until resolved manually
  - Depends on: Module 13+

---

## Module 02 Port: Auction Mechanics

- [ ] **TODO:** Wire `closeAuction` orchestrator to a Supabase repo adapter (Module 11)
  - Context: `closeOrchestrator.ts` depends on `AuctionsAggregateRepoPort`, `ListingsRepoPort`, and
    `AuctionsMetaRepoPort`. These are port interfaces — a Supabase implementation needs to be written
    when Module 11 (Settlement) is built.
  - Priority: HIGH — required before settlement flow works end-to-end
  - Depends on: Module 11 (Settlement)

- [ ] **TODO:** Consider porting `auction.offerCascade.orchestrator.ts`
  - Context: `functions/src/v1/services/orchestration/auction.offerCascade.orchestrator.ts` handles
    the reserve-not-met → next-bidder cascade flow. Not ported in Module 02 — only the primary
    close path was needed. Port when the cascade flow is required.
  - Priority: LOW
  - Depends on: Module 11 (Settlement)

---

## Module 10: Admin Dashboard Frontend

- [ ] **TODO:** Add `GET /admin/health` endpoint to the backend
  - Context: AdminHealthPage polls this endpoint every 30s but it doesn't exist in the Module 10 backend routes (index.ts only mounts `/users`, `/moderation`, `/audit-logs`). The page handles the 404 gracefully with a warning.
  - Priority: LOW — cosmetic; admin functionality works without it
  - Depends on: Backend work in a future pass

- [ ] **TODO:** Resolve AdminProtectedRoute RLS dependency
  - Context: `AdminProtectedRoute` uses the anon Supabase client to query `admin_users`. If RLS prevents users from reading their own admin_users row, valid admins will be redirected to `/`. Consider adding a `/admin/auth/verify` backend endpoint instead.
  - Priority: MEDIUM — affects admin access if RLS is restrictive
  - Depends on: RLS policy review on `admin_users` table

- [ ] **TODO:** Moderation queue listing_media join
  - Context: Moderation cards cannot show listing images because the backend query does not join `listing_media`. A note is shown in each card. Requires backend change to include media URLs in the queue response.
  - Priority: LOW — audit/moderation workflow still functional
  - Depends on: Backend route update + adminApi.ts update

---

## Module 09: Payment Hardening

- [ ] **TODO:** Add `default_content_flag content_flag` column to `categories` table
  - Context: CONTENT_FLAG_GUIDELINES.md documents this field but it doesn't exist in the DB. Currently using `categories.is_nsfw` (boolean) as a proxy for MEDIUM risk floor. A proper per-category content flag would enable more granular routing (e.g., SWIMWEAR-default category → MEDIUM, not just is_nsfw=true).
  - Priority: MEDIUM
  - Depends on: DB migration + `supabase gen types` re-run

- [ ] **TODO:** Add SWIMWEAR, LINGERIE, PERSONAL_ITEM, FETISH to `content_flag` DB enum
  - Context: These flags appear in CONTENT_FLAG_GUIDELINES.md and FLAG_SCORES but don't exist in the database content_flag enum. CascadeOrchestrator silently ignores unrecognized flags.
  - Priority: MEDIUM
  - Depends on: DB migration + `supabase gen types` re-run

- [ ] **TODO:** Implement real NOWPayments integration in process-payment
  - Context: Crypto path returns 501 stub. Needs NOWPAYMENTS_API_KEY + NOWPAYMENTS_IPN_SECRET, invoice creation via `POST /v1/invoice`, crypto_payments record creation.
  - Priority: LOW (user opt-in, not blocking mainstream flow)
  - Depends on: NOWPayments merchant account + API keys

- [ ] **TODO:** Add Stripe transactionId to payment_intent metadata for webhook correlation
  - Context: StripeProcessor.processPayment creates a PaymentIntent but doesn't set `metadata.transactionId`. The webhook handler uses `paymentIntent.metadata.transactionId` — without it, it falls back to the Stripe PaymentIntent ID which doesn't match our transactions.id (UUID).
  - Priority: HIGH — required for webhook → transaction status updates to work
  - Fix: Pass `transactionId` in metadata when creating the PaymentIntent

- [ ] **TODO:** Deploy process-payment and payment-webhook Edge Functions
  - Context: Functions are hardened and ready. Blocked on: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET env vars in Supabase dashboard.
  - Priority: HIGH
  - Depends on: See docs/PAYMENT_DEPLOY_CHECKLIST.md

## Module 06: Browse & Search

- [ ] **TODO:** Add pagination to browse and search results
  - Context: Currently hardcoded `.limit(24)` for browse and `.limit(48)` for search
  - Priority: MEDIUM
  - Depends on: Standalone

- [ ] **TODO:** Replace ilike search with full-text search
  - Context: Basic ilike on title/description is slow and imprecise at scale
  - Priority: HIGH
  - Depends on: Module 14 (Enhanced Search)

- [ ] **TODO:** Add loading skeletons to BrowsePage and SearchResultsPage
  - Context: No loading state during Supabase fetch — text placeholder only, page appears partially empty briefly
  - Priority: LOW
  - Depends on: Standalone

- [ ] **TODO:** Move sort to database level for ending soonest / price sorts
  - Context: Currently sorting client-side after fetch. Works for small datasets but won't scale.
  - Priority: MEDIUM
  - Depends on: Module 14 (Enhanced Search)

## Module 13: NFC Verification

- [ ] **TODO:** Apply DB migration and regenerate types
  - Context: `supabase/migrations/20260301100000_nfc_verification.sql` adds `item_verifications` + `ownership_transfers` tables. After applying, run `npx supabase gen types typescript --project-id pmlofthmobglcfkqjtru > frontend/src/types/database.types.ts && cp ...`. Then remove `(supabase.from as any)` cast in `TokenCreationPage.tsx`.
  - Priority: HIGH — required before verification feature works
  - Depends on: Supabase CLI + project credentials

- [ ] **TODO:** iOS NFC tag programming UX
  - Context: Web NFC API not supported on iOS. Current flow shows instructions to use NFC Tools app. Could improve with a deep-link to the app store or step-by-step screenshot guide.
  - Priority: MEDIUM

- [ ] **TODO:** Push notifications when item is scanned (Module 16)
  - Context: When a buyer scans an NFC-verified item, the owner could receive a push notification. Requires web push / FCM integration.

- [ ] **TODO:** Anti-counterfeit — server-side NTAG 424 DNA cryptographic SUN message verification
  - Context: NTAG 424 DNA tags generate a cryptographic SUN message in the URL on each scan. A future endpoint could verify this signature server-side using the tag's key, making tag cloning detectable.
  - Priority: LOW (future)

- [ ] **TODO:** Supabase Realtime subscription on VerificationPage for live scan count updates
  - Context: VerificationPage currently shows a static scan count fetched on load. A Realtime subscription on `item_verifications` would update the count live.
  - Priority: LOW
