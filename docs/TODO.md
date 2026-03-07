# AuctionX — TODO Tracker

Last updated: 2026-03-07 (Session I — Design System Fixes + Admin RLS Fix + Staging Deploy)

---

## Auth / Session Fixes

- [x] **DONE (Session H_c):** Fix ProtectedRoute race condition — add `initialized` guard
  - `App.tsx` inline ProtectedRoute now checks `!initialized || loading` before rendering
  - Removed redundant page-level auth redirects from `MyListings.tsx` and `ProfilePage.tsx`
  - Deleted unused `features/auth/components/ProtectedRoute.tsx` (zero imports)
- [x] **DONE (Session I):** Deploy auth fixes to staging — Session H fixes were in code but never deployed
  - Built and deployed to S3 + CloudFront invalidation

---

## Design System Fixes

- [x] **DONE (Session I):** Fix button gradient bleed — added `overflow-hidden` to Button.tsx baseClasses
- [x] **DONE (Session I):** Fix text contrast violations — replaced `text-gray-500` → `text-gray-400`, `text-gray-600` → `text-gray-500` across 42 files (102 occurrences)
- [x] **DONE (Session I):** Document Unmentionables nav link pink accent as accepted brand exception

---

## Admin Dashboard

- [x] **DONE (Session I):** Fix admin_users RLS infinite recursion — created SECURITY DEFINER helpers
- [x] **DONE (Session I):** Fix TEXT vs admin_permission enum type mismatch in RLS helper
- [x] **DONE (Session I):** Insert admin_users row for Boss's UUID (was missing from table)
- [ ] **TODO:** Admin dashboard API calls return errors ("Insufficient permissions")
  - Context: Frontend `/admin` renders correctly (sidebar, nav, user email). But API calls to App Runner backend (`/api/v1/admin/audit-logs`, `/api/v1/admin/users`, `/api/v1/admin/moderation/queue`) fail. The `adminAuth` middleware on the deployed backend may have wrong `SUPABASE_SERVICE_ROLE_KEY` env var (`sb_secret_uOUktG_...` in `backend/.env` is not a JWT — the real service role JWT is `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtbG9mdGhtb2JnbGNma3FqdHJ1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSI...`). Check App Runner env vars and redeploy backend.
  - Priority: HIGH — admin dashboard non-functional without working API
  - Depends on: Correct service role key in App Runner environment

---

## Module 18: Launch Prep

- [ ] **TODO:** Activate Sentry error tracking
  - Context: `frontend/src/lib/errorTracking.ts` has Sentry calls commented out. When ready: `npm install @sentry/react`, set `VITE_SENTRY_DSN` env var in Vercel, uncomment the Sentry init + captureException calls.
  - Priority: HIGH — required for production error visibility
  - File: `frontend/src/lib/errorTracking.ts`

- [ ] **TODO:** Create `og-image.png` asset
  - Context: `frontend/index.html` references `/og-image.png` for Open Graph and Twitter Card previews. This file does not exist yet. Create a 1200×630px branded image.
  - Priority: MEDIUM — affects link previews on social media

- [ ] **TODO:** Set up sitemap generation cron
  - Context: `scripts/generateSitemap.ts` is a stub that generates `sitemap.xml` from active listings + NFC tokens. Wire it to the CI/CD pipeline or a daily cron job once Supabase credentials are available in the build environment.
  - Priority: LOW — improves SEO discoverability
  - Depends on: Supabase credentials in build environment

- [ ] **TODO:** Add `GET /admin/health` endpoint
  - Context: `AdminHealthPage` polls `/api/v1/admin/health` every 30s but the endpoint is not implemented. The page handles the 404 gracefully. Module 18 introduced `/api/v1/health` (DB ping), but the admin-specific health page needs a richer endpoint including queue depths and processor status.
  - Priority: LOW — admin functionality works without it
  - Depends on: Backend route addition

---

## Module 17: E2E Testing & Security Audit

- [ ] **TODO:** Seed real test users in Supabase for E2E tests
  - Context: E2E specs (`auth.spec.ts`, `admin.spec.ts`, `auction.spec.ts`) require `TEST_USER_EMAIL` and `TEST_ADMIN_EMAIL` to point to real Supabase users. Create these users via Supabase dashboard → Authentication → Users, then set credentials in `.env.test`.
  - Priority: HIGH — without test users, authenticated E2E tests are skipped

- [x] **DONE:** Add rate limit to `GET /search` endpoint
  - Added `searchRateLimit` (60 req/min) via `router.use()` in `routes/search.ts`

- [ ] **TODO:** Replace in-memory admin rate limit Map with persistent store
  - Context: The admin rate limiter uses an in-memory Map that resets on server restart. Replace with Redis or Supabase-backed store.
  - Priority: MEDIUM

- [ ] **TODO:** Set up CI pipeline for automated test runs
  - Context: `package.json` at root now has `test:all`, `test:e2e`, `test:api`, `test:mechanics` scripts. Wire these to GitHub Actions or similar CI on pull requests.
  - Priority: MEDIUM — prevents regressions on future modules

---

## Module 16: Notifications System

- [ ] **TODO:** Resend email integration
  - Context: `emailSender.ts` is a stub that logs intent only. When `RESEND_API_KEY` is available, install `resend` package and replace the stub body with `resend.emails.send(...)`.
  - Priority: HIGH — required for real email delivery

- [ ] **TODO:** Offline check before sending MESSAGE_RECEIVED email
  - Context: `messagingController.sendMessage` always sends a notification to the recipient. Ideally it should check if the recipient has been active in the last 5 minutes (e.g., via presence/Realtime heartbeat) and skip the email if they're online.
  - Priority: MEDIUM — avoids unnecessary emails for active users

- [ ] **TODO:** PAYMENT_WINDOW_EXPIRING trigger (pg_cron job)
  - Context: The `payment_window_expiring` preference column is defined and documented, but no trigger currently fires this notification. A pg_cron job should check for offers expiring within ~5 minutes and insert PAYMENT_WINDOW_EXPIRING notifications.
  - Priority: MEDIUM — improves buyer experience during settlement

- [x] **DONE:** Add FRONTEND_URL env var to all edge functions
  - All 4 edge functions already use `Deno.env.get('FRONTEND_URL') || 'http://localhost:5173'`
  - Remaining: set `FRONTEND_URL` in Supabase dashboard secrets (ops task, not code)

---

## Module 14: Enhanced Search

- [ ] **TODO:** Apply DB migration and regenerate types
  - Context: `supabase/migrations/20260302000001_full_text_search.sql` adds `search_vector` column + GIN index + `saved_searches` table. After applying, run `npx supabase gen types typescript --project-id pmlofthmobglcfkqjtru > frontend/src/types/database.types.ts && cp ...`. Until then, `.textSearch('search_vector')` uses `as never` assertion.
  - Priority: HIGH — required before full-text search works in production
  - Depends on: Supabase CLI + project credentials

- [ ] **TODO:** Explicit ts_rank ordering for relevance sort
  - Context: `textSearch()` returns results in relevance order naturally via PostgREST, but a raw SQL `ORDER BY ts_rank(search_vector, plainto_tsquery('english', $q)) DESC` would give more explicit control. Not implemented because the default behavior is correct for the common case.
  - Priority: LOW

- [ ] **TODO:** Saved search email notifications
  - Context: `notify_new_results` column is stored in `saved_searches` but there is no background worker or cron to check for new matches and send notifications. Would require a Supabase Cron job + email provider integration.
  - Priority: MEDIUM

- [ ] **TODO:** BrowsePage category grid pagination
  - Context: Categories are fetched in one query (no limit). Acceptable at current scale (< 20 categories). If categories grow large, paginate or use virtual scroll.
  - Priority: LOW

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

- [x] **DONE:** Implement admin dispute resolution (approve → refund, reject → release)
  - `POST /api/v1/admin/disputes/:id/approve` → DISPUTED → REFUNDED (with notes)
  - `POST /api/v1/admin/disputes/:id/reject` → DISPUTED → ESCROW_HOLD (restores release-escrow eligibility)
  - TODO: Wire actual Stripe refund in approve path once Stripe Connect is configured

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

- [x] **DONE:** Add `default_content_flag TEXT` column to `categories` table
  - Migration: `supabase/migrations/20260303000002_content_flag_enum_expansion.sql`
  - Pending: `npx supabase db push` + `supabase gen types` re-run

- [x] **DONE:** Add SWIMWEAR, LINGERIE, PERSONAL_ITEM, FETISH to `content_flag` DB enum
  - Migration: `supabase/migrations/20260303000002_content_flag_enum_expansion.sql`
  - Pending: `npx supabase db push` + update CascadeOrchestrator FLAG_SCORES with scores 3–5

- [ ] **TODO:** Implement real NOWPayments integration in process-payment
  - Context: Crypto path returns 501 stub. Needs NOWPAYMENTS_API_KEY + NOWPAYMENTS_IPN_SECRET, invoice creation via `POST /v1/invoice`, crypto_payments record creation.
  - Priority: LOW (user opt-in, not blocking mainstream flow)
  - Depends on: NOWPayments merchant account + API keys

- [x] **DONE:** Add Stripe transactionId to payment_intent metadata for webhook correlation
  - `StripeProcessor.ts` now builds a clean `stripeMetadata` with `transactionId`, `auctionId`, `listingId`, `sellerId`
  - `process-payment/index.ts` now sets `paymentRequest.metadata.auctionId = auction.id` before cascade

- [x] **DONE (Session E):** Fix missing `await` on `constructEventAsync` in StripeProcessor webhook handler
  - `StripeProcessor.ts` line 138: `constructEventAsync` returns `Promise<Stripe.Event>` — was missing `await`
  - Without `await`, the event variable was a Promise object, not the resolved event — webhook handling silently broken

- [x] **DONE (Session E):** Add missing type definitions to `_shared/payment/types.ts`
  - Added: `ProcessorResult`, `RefundResult`, `HealthCheckResult`, `PaymentProcessor`, `PaymentIntent`
  - Were imported by `StripeProcessor.ts`, `BaseProcessor.ts`, `PaymentCloudProcessor.ts` but never defined

- [ ] **TODO:** Deploy process-payment and payment-webhook Edge Functions
  - Context: Functions are hardened and ready. Blocked on: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET env vars in Supabase dashboard.
  - Priority: HIGH
  - Depends on: See docs/PAYMENT_DEPLOY_CHECKLIST.md

## Module 06: Browse & Search

- [x] **DONE (Module 14):** Add pagination to browse and search results
- [x] **DONE (Module 14):** Replace ilike search with full-text search
- [x] **DONE (Module 14):** Move sort to database level for ending soonest / price sorts

- [ ] **TODO:** Add loading skeletons to BrowsePage and SearchResultsPage
  - Context: No loading state during fetch — text placeholder only, page appears partially empty briefly
  - Priority: LOW
  - Depends on: Standalone

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

## Module 15: Messaging

- [ ] **TODO:** Apply DB migration and regenerate types
  - Context: `supabase/migrations/20260302120000_messaging.sql` adds `conversations` + `messages` tables. After applying, run `npx supabase gen types typescript --project-id pmlofthmobglcfkqjtru > frontend/src/types/database.types.ts && cp ...`. Then remove `as never` casts in `ConversationsPage.tsx` and `Header.tsx`.
  - Priority: HIGH — required before messaging feature works
  - Depends on: Supabase CLI + project credentials

- [ ] **TODO:** RLS policy allows service client to bypass participant checks — validate participant in DB layer
  - Context: messagingController.ts uses service client + manual participant checks. For defense-in-depth, an RLS policy using `service_role` bypass is acceptable but worth noting.
  - Priority: LOW

- [ ] **TODO:** Mobile nav menu — add Messages link to mobile hamburger / nav drawer
  - Context: Messages link is added to desktop nav (md+) only. Mobile users need access via the mobile nav menu when it is built.
  - Priority: MEDIUM — depends on mobile nav implementation

- [ ] **TODO:** Message pagination — load older messages on scroll up
  - Context: `getMessages` supports `page` param but ConversationsPage only loads page 1. "Load earlier messages" UI needed for long conversations.
  - Priority: MEDIUM

- [ ] **TODO:** Unread badge count in the `useUnreadCount` hook queries ALL messages not sent by the user, not scoped to conversations the user participates in — after type regen, tighten the query to use an IN subquery on `conversations`.
  - Context: Until DB types include conversations/messages, using `as never` cast prevents the scoped query. Post-type-regen: use `.in('conversation_id', participantConvIds)`.
  - Priority: MEDIUM
