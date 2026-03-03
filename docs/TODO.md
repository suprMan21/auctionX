# AuctionX — TODO Tracker

Last updated: 2026-03-03 (Module 16 added)

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

- [ ] **TODO:** Add FRONTEND_URL env var to all edge functions
  - Context: Edge functions (settle-auction, check-payment-window, release-escrow, payment-webhook) use `Deno.env.get('FRONTEND_URL')` for action URLs in notifications. This must be set in `supabase/.env.local` and Supabase dashboard secrets.
  - Priority: HIGH — otherwise notification action_urls point to localhost in production

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
