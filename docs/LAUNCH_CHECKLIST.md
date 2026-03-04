# AuctionX — Pre-Launch Checklist

**Last Updated:** 2026-03-03 (Module 18)
**Status:** Draft — work through all items before going live

---

## 1. Database

- [ ] Apply all pending migrations via `npx supabase db push`
  - `20260301000001_auction_settlement.sql`
  - `20260301000002_payouts_table.sql`
  - `20260301100000_nfc_verification.sql`
  - `20260302000001_full_text_search.sql`
  - `20260302120000_messaging.sql`
  - `20260303000001_notifications.sql`
- [ ] Regenerate TypeScript types after migrations
  ```bash
  npx supabase gen types typescript --project-id pmlofthmobglcfkqjtru \
    > frontend/src/types/database.types.ts
  cp frontend/src/types/database.types.ts backend/src/types/database.types.ts
  ```
- [ ] Remove all `as never` / `as any` casts added as migration-pending workarounds
  - `ConversationsPage.tsx` — unread count query
  - `Header.tsx` — unread badge count
  - `SearchResultsPage.tsx` — search_vector textSearch
  - `TokenCreationPage.tsx` — item_verifications from()
  - `PayoutsPage.tsx` — payouts table join
- [ ] Enable `pg_cron` + `pg_net` extensions in Supabase dashboard
  - Required for: `release-escrow` edge function scheduling
- [ ] Add `PAYMENT_WINDOW_EXPIRING` pg_cron job (check offers expiring within 5 minutes)
- [ ] Verify Row Level Security on all 31 tables
  - Check `admin_users` RLS permits users to read their own row (AdminProtectedRoute dependency)
  - Consider adding `GET /admin/auth/verify` backend endpoint as RLS-independent fallback
- [ ] Verify `realtime` publication includes: `notifications`, `conversations`, `messages`, `auctions`, `bids`
- [ ] Back up database before first production migration push

---

## 2. Environment Variables

### Backend (Railway / Heroku / wherever Express is hosted)

- [ ] `SUPABASE_URL` — `https://pmlofthmobglcfkqjtru.supabase.co`
- [ ] `SUPABASE_ANON_KEY` — from Supabase dashboard → Settings → API
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — from Supabase dashboard → Settings → API (keep secret)
- [ ] `FRONTEND_URL` — production domain (e.g. `https://auctionx.com`)
- [ ] `PORT` — set by host automatically (Railway sets this)
- [ ] `NODE_ENV` — `production`
- [ ] `SETTLE_SECRET` — random 32+ char secret; must match `SETTLE_SECRET` in edge functions
- [ ] `RELEASE_ESCROW_SECRET` — random 32+ char secret; must match in release-escrow edge fn
- [ ] `AWS_ACCESS_KEY_ID` — for S3 presigned URL generation (NFC video proof uploads)
- [ ] `AWS_SECRET_ACCESS_KEY`
- [ ] `AWS_REGION` — `us-east-1`
- [ ] `S3_BUCKET_NAME` — `auctionx-media-prod-cl`

### Frontend (Vercel)

- [ ] `VITE_SUPABASE_URL` — `https://pmlofthmobglcfkqjtru.supabase.co`
- [ ] `VITE_SUPABASE_ANON_KEY`
- [ ] `VITE_API_URL` — backend base URL (e.g. `https://api.auctionx.com`)
- [ ] `VITE_AWS_REGION` — `us-east-1`
- [ ] `VITE_S3_BUCKET` — `auctionx-media-prod-cl`

### Supabase Edge Functions

- [ ] `STRIPE_SECRET_KEY` — **BLOCKING** — process-payment can't run without this
- [ ] `STRIPE_WEBHOOK_SECRET` — for webhook signature verification
- [ ] `FRONTEND_URL` — production domain for notification action_urls
- [ ] `SETTLE_SECRET` — must match backend
- [ ] `RELEASE_ESCROW_SECRET` — must match backend
- [ ] `RESEND_API_KEY` — for transactional email delivery (currently stub)
- [ ] `PAYMENTCLOUD_API_KEY` — pending
- [ ] `CCBILL_ACCOUNT_NUMBER` + `CCBILL_SUB_ACCOUNT` — pending
- [ ] `SIGNATURE_MERCHANT_ID` — pending
- [ ] `NOWPAYMENTS_API_KEY` — pending (user opt-in crypto, not blocking)
- [ ] `NOWPAYMENTS_IPN_SECRET` — pending

---

## 3. Payment Processing

> See `docs/PAYMENT_DEPLOY_CHECKLIST.md` for full payment-specific steps.

- [ ] **CRITICAL:** Add `transactionId` to Stripe PaymentIntent metadata
  - File: `supabase/functions/_shared/payment/processors/StripeProcessor.ts`
  - Without this, payment-webhook can't correlate Stripe events to internal transactions
- [ ] Deploy `process-payment` edge function after env vars are set:
  ```bash
  supabase functions deploy process-payment
  ```
- [ ] Deploy `payment-webhook` edge function
- [ ] Deploy `settle-auction` edge function
- [ ] Deploy `check-payment-window` edge function
- [ ] Deploy `release-escrow` edge function
- [ ] Configure Stripe webhook endpoint in Stripe dashboard:
  - URL: `https://pmlofthmobglcfkqjtru.supabase.co/functions/v1/payment-webhook`
  - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`
- [ ] Set up `release-escrow` cron (every 5 minutes via pg_cron or external scheduler)
- [ ] Test full payment cascade in Stripe test mode before go-live
- [ ] Confirm NOWPayments integration is 501-stubbed (user opt-in, not blocking mainstream)

---

## 4. Security

- [ ] Add rate limiting to `GET /api/v1/search` (60 req/min recommended)
  - File: `backend/src/routes/search.ts`
  - Priority: HIGH — resource exhaustion / scraping risk
- [ ] Replace in-memory admin rate limit Map with persistent store (Redis or Supabase)
  - Currently resets on server restart, allowing brute-force in crash loops
- [ ] Verify CORS origin is set to production domain (not `*`)
  - File: `backend/src/server.ts` — `FRONTEND_URL` env var must be set
- [ ] Content Security Policy headers (consider adding to `vercel.json`)
- [ ] Review S3 bucket policy — ensure `auctionx-media-prod-cl` is not publicly writable
- [ ] Rotate Supabase service role key if it was ever committed to version control
- [ ] Verify `content_flags` in `process-payment` are sourced server-side (not from client body)

---

## 5. Edge Functions & Cron

- [ ] All 5 edge functions deployed (see payment section above)
- [ ] `release-escrow` cron configured and tested
- [ ] `check-payment-window` — confirm it can be triggered by Supabase scheduled functions or pg_cron
- [ ] `FRONTEND_URL` set in Supabase dashboard secrets for all edge functions

---

## 6. DNS & Hosting

- [ ] Vercel project connected to `auctionx.com` custom domain
- [ ] HTTPS enforced (Vercel handles this automatically)
- [ ] Backend deployed to Railway (or equivalent) with health check passing:
  `GET /api/v1/health` → 200
- [ ] Custom domain for backend API (e.g. `api.auctionx.com`) configured
- [ ] `FRONTEND_URL` and `VITE_API_URL` updated to production domains

---

## 7. Content & Legal

- [ ] Privacy policy page at `/privacy`
- [ ] Terms of service page at `/terms`
- [ ] Age verification flow for Authentic Materials NSFW content
- [ ] DMCA contact info and takedown process documented
- [ ] Cookie consent banner (if serving EU users)
- [ ] `og-image.png` asset created and uploaded to `/public/og-image.png`
  - Dimensions: 1200×630px
  - Currently referenced in index.html but file does not exist

---

## 8. Deploy Sequence

Run in this order to avoid dependency issues:

1. **Apply DB migrations** — `npx supabase db push` — all 6 migrations
2. **Regenerate types** — `supabase gen types typescript ...` — both frontend + backend
3. **Remove `as never` / `as any` casts** — confirm 0 TS errors: `npx tsc --noEmit`
4. **Deploy Supabase edge functions** — all 5 functions with env vars set
5. **Deploy backend to Railway** — verify `/api/v1/health` returns 200
6. **Deploy frontend to Vercel** — confirm `vercel.json` rewrites are active
7. **Configure Stripe webhook** in Stripe dashboard → point to edge function URL
8. **Smoke test** end-to-end: register → list → bid → settle → pay → release

---

## 9. Post-Launch: First 24 Hours

- [ ] Monitor Supabase logs for edge function errors
- [ ] Monitor Railway logs for unhandled errors
- [ ] Check Vercel Analytics for 4xx/5xx rates
- [ ] Confirm first auction settlement triggers correct notifications
- [ ] Verify payment-webhook is receiving and processing Stripe events
- [ ] Confirm email notifications are delivered (once Resend is integrated)
- [ ] Set up Sentry error tracking:
  - Install `@sentry/react` in frontend
  - Set `VITE_SENTRY_DSN` env var
  - Uncomment Sentry calls in `frontend/src/lib/errorTracking.ts`
- [ ] Seed test auction with known end time to verify settlement cascade

---

## Known Remaining Issues at Launch (non-blocking)

| Issue | File | Priority |
|-------|------|----------|
| `ForgotPasswordPage` uses light-mode Tailwind classes | `pages/ForgotPasswordPage.tsx` | LOW |
| `og-image.png` asset missing | `frontend/public/` | MEDIUM |
| Stripe `transactionId` not passed in PaymentIntent metadata | `StripeProcessor.ts` | HIGH |
| NOWPayments integration is 501 stub | `_shared/payment/processors/NowPaymentsProcessor.ts` | LOW |
| Firebase config files still present | `.firebaserc`, `firebase.json` | LOW |
| Module 01 schemas import `firebase-admin` | `functions/src/v1/schemas/` | LOW |
