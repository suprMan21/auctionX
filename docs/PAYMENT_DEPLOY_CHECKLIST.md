# Payment Edge Function — Deploy Checklist

Last updated: 2026-05-09 (post-deploy reconciliation)

> **🚀 DEPLOY STATUS (as of 2026-05-09):** All three payment edge functions are LIVE on `pmlofthmobglcfkqjtru`:
> - `process-payment` — v17, ACTIVE, `verify_jwt: true`
> - `payment-webhook` — v18, ACTIVE, `verify_jwt: false` (signatures verified by processor)
> - `release-escrow` — v6, ACTIVE, `verify_jwt: true` (uses `x-release-secret` shared-secret header instead)
>
> **The only remaining gate for real card processing is the Stripe env vars** (Phase 1 below). Code is hardened, deployed, and waiting.

---

## Phase 1: Stripe-Only Deploy (Ready When Keys Available)

### Environment Variables (set in Supabase dashboard → Edge Functions → Secrets)

- [ ] `STRIPE_SECRET_KEY` — Stripe live secret key (sk_live_...) **← OUTSTANDING**
- [ ] `STRIPE_WEBHOOK_SECRET` — From Stripe dashboard → Webhooks → signing secret (whsec_...) **← OUTSTANDING**
- [x] `SUPABASE_URL` — Auto-provided by Supabase Edge runtime
- [x] `SUPABASE_ANON_KEY` — Auto-provided
- [x] `SUPABASE_SERVICE_ROLE_KEY` — Set (rotated to `sb_secret_` format 2026-05-09)

### Stripe Dashboard Setup

- [ ] Create webhook endpoint in Stripe dashboard:
  - URL: `https://pmlofthmobglcfkqjtru.supabase.co/functions/v1/payment-webhook/stripe`
  - Events to listen for: `payment_intent.succeeded`, `payment_intent.payment_failed`
- [ ] Set `STRIPE_WEBHOOK_SECRET` from the webhook signing secret shown above

### Pre-Deploy Tests (run in test mode first)

- [ ] `process-payment` returns 401 without Authorization header
- [ ] `process-payment` returns 400 for missing `listingId` in metadata
- [ ] `process-payment` returns 501 for `paymentMethod.type === 'CRYPTO'`
- [ ] `process-payment` creates Stripe PaymentIntent for LOW risk listing (Stripe test key)
- [ ] `process-payment` enforces server-side risk floor: NSFW listing cannot route to Stripe
- [ ] `payment-webhook` verifies stripe-signature and rejects invalid signatures (return 401)
- [ ] `payment-webhook` updates transaction status to SUCCEEDED on `payment_intent.succeeded`
- [ ] `payment_attempts` table has rows after each cascade attempt
- [ ] Content flags in `transactions` reflect server-enforced floor, not client-provided values

### Deploy Commands

```bash
cd unmentionables/Unmen/

# Deploy Edge Functions (run from project root) — ALWAYS pass --use-api
# Without --use-api the CLI hangs waiting for Docker; with it, deploy goes
# direct to the platform API.
supabase functions deploy process-payment --use-api --project-ref pmlofthmobglcfkqjtru
supabase functions deploy payment-webhook --use-api --project-ref pmlofthmobglcfkqjtru
supabase functions deploy release-escrow --use-api --project-ref pmlofthmobglcfkqjtru
```

### Post-Deploy Smoke Test

```bash
# Test auth gate (should return 401)
curl -X POST https://pmlofthmobglcfkqjtru.supabase.co/functions/v1/process-payment \
  -H "Content-Type: application/json" \
  -d '{}' | jq .

# Test with valid JWT (obtain from Supabase Auth)
curl -X POST https://pmlofthmobglcfkqjtru.supabase.co/functions/v1/process-payment \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"amount": 10000, "currency": "CAD", "paymentMethod": {"type": "CARD"}, "metadata": {}}' | jq .
# Expected: 400 (missing listingId)
```

---

## Phase 2: Additional Card Processors (When Keys Obtained)

### PaymentCloud (NMI gateway)

- [ ] Obtain from PaymentCloud merchant portal:
  - `PAYMENTCLOUD_API_KEY`
  - `PAYMENTCLOUD_SECURITY_KEY`
- [ ] Set env vars in Supabase dashboard
- [ ] Register webhook URL: `https://pmlofthmobglcfkqjtru.supabase.co/functions/v1/payment-webhook/paymentcloud`
- [ ] Test: MEDIUM risk listing routes to PaymentCloud first

### Signature Payments

- [ ] Obtain from Signature Payments merchant portal:
  - `SIGNATURE_API_KEY`
  - `SIGNATURE_API_LOGIN_ID`
  - `SIGNATURE_TRANSACTION_KEY`
- [ ] Register webhook URL: `https://pmlofthmobglcfkqjtru.supabase.co/functions/v1/payment-webhook/signature`
- [ ] Test: HIGH risk listing routes to Signature first

### CCBill (Final Fallback)

- [ ] Obtain from CCBill merchant portal:
  - `CCBILL_ACCOUNT_NUMBER`
  - `CCBILL_SUBACCOUNT_NUMBER`
  - `CCBILL_FLEXFORMS_ID`
  - `CCBILL_SALT_KEY`
- [ ] Register webhook URL: `https://pmlofthmobglcfkqjtru.supabase.co/functions/v1/payment-webhook/ccbill`
- [ ] Note: CCBill returns a hosted form URL (PENDING status) — buyer completes payment on CCBill's page
- [ ] Note: CCBill refunds are manual (no API refund endpoint)

---

## Phase 3: Crypto Payments (NOWPayments)

NOWPayments is **never** part of the automatic cascade — it is user opt-in at checkout.

- [ ] Obtain from NOWPayments merchant portal:
  - `NOWPAYMENTS_API_KEY`
  - `NOWPAYMENTS_IPN_SECRET`
- [ ] Implement real NOWPayments invoice creation in `process-payment/index.ts`
  - Replace the 501 stub with `POST https://api.nowpayments.io/v1/invoice`
  - Return `crypto_address`, `invoice_url`, `payment_id` to frontend
- [ ] Create `crypto_payments` table record on invoice creation
- [ ] Register IPN callback: `https://pmlofthmobglcfkqjtru.supabase.co/functions/v1/payment-webhook/nowpayments`
- [ ] Test: Buyer selecting "Pay with Crypto" receives invoice details, 72-hour window set

---

## Architecture Notes

- **Content flag security**: Flags are validated server-side. `listing.is_nsfw` and `category.is_nsfw` enforce a minimum risk floor that clients cannot downgrade.
- **Payment attempts**: Every cascade attempt (success or fail) is logged to `payment_attempts` with `transaction_id`, `processor`, `success`, timing, and raw response.
- **Transaction created before cascade**: `transactions` record is created with PENDING status before the cascade runs, ensuring a DB record exists even if the orchestrator crashes.
- **Cascade stops at first success**: If Stripe succeeds, PaymentCloud/Signature/CCBill are never called.
- **Crypto is separate**: `paymentMethod.type === 'CRYPTO'` exits early — never touches the card cascade.
