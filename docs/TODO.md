# AuctionX — TODO Tracker

Last updated: 2026-03-01 (Module 09 added)

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
