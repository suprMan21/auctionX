# Session Addendum — Stripe Webhook Debugging
Date: 2026-03-03
Follows: SESSION_HIGH_PRIORITY_FIXES.md

---

## What Happened After the Session

The HIGH priority fix session completed cleanly (0 TS errors, all fixes applied), but
end-to-end Stripe webhook verification failed during manual testing. This addendum documents
the debugging steps and two fixes applied post-session.

---

## Issue 1 — Webhook returning 401

**Symptom:** Stripe was sending POST requests to the Edge Function but getting 401 back.
No log output at all — function wasn't even booting.

**Root cause:** Supabase Edge Functions require a valid Supabase JWT by default. Stripe
has no way to provide one — it's an external service.

**Fix:**
```bash
npx supabase functions deploy payment-webhook --no-verify-jwt
```

**Why this is safe:** The function still validates Stripe's own webhook signature via
`constructEventAsync`. Disabling JWT just means "don't require Supabase auth on this
endpoint" — it does not remove security. The Stripe signature check IS the security.

**Rule:** Any Edge Function that receives webhooks from external services (Stripe, NOWPayments,
CCBill, etc.) must be deployed with `--no-verify-jwt`. Internal-only functions should keep
JWT verification enabled.

---

## Issue 2 — Signature verification failing in Deno

**Symptom:** After fixing the 401, logs showed:
```
Stripe webhook signature verification failed
Webhook: Processor returned null (verification failed)
```

The webhook secret was correctly set, the body was being read as `req.text()` (correct),
and the code looked fine. Error persisted across multiple secret rotations and redeployments.

**Root cause:** Stripe's synchronous `webhooks.constructEvent()` uses Node's
`crypto.timingSafeEqual` internally. This does **not** work reliably in Deno's Node
compatibility layer — it silently fails signature checks instead of throwing a meaningful
error, making it look like a secret mismatch when it isn't.

**Fix:** Replace synchronous `constructEvent` with the async version designed for
non-Node runtimes:

```bash
sed -i '' 's/this\.stripe\.webhooks\.constructEvent(body/this.stripe.webhooks.constructEventAsync(body/g' \
  supabase/functions/_shared/payment/processors/StripeProcessor.ts
```

Then redeploy:
```bash
npx supabase functions deploy payment-webhook --no-verify-jwt
```

**Rule:** In Deno Edge Functions, always use `stripe.webhooks.constructEventAsync()`
instead of `stripe.webhooks.constructEvent()`. The sync version is for Node only.

---

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/_shared/payment/processors/StripeProcessor.ts` | `constructEvent` → `constructEventAsync` |

---

## Ops Tasks Completed

| Task | Status |
|------|--------|
| `STRIPE_WEBHOOK_SECRET` set via Supabase CLI (`npx supabase secrets set`) | ✅ Done |
| `payment-webhook` deployed with `--no-verify-jwt` | ✅ Done |
| End-to-end webhook test (`stripe trigger payment_intent.succeeded`) | ✅ Verified |

---

## Remaining Ops Tasks (unchanged from main session report)

| Task | Blocked on |
|------|-----------|
| `npx supabase db push` | Supabase CLI credentials |
| `supabase gen types typescript` → regen `database.types.ts` | After db push |
| Set `FRONTEND_URL` in Supabase dashboard → Edge Functions secrets | Deployment |
| Set `STRIPE_SECRET_KEY` + `STRIPE_PUBLISHABLE_KEY` | Already set via CLI |
| Implement Stripe refund in dispute approve path | Stripe Connect onboarding |

---

## Commit

```bash
git add supabase/functions/_shared/payment/processors/StripeProcessor.ts
git commit -m "fix: use constructEventAsync for Stripe webhook signature verification in Deno

- constructEvent (sync) uses Node crypto.timingSafeEqual which silently fails in Deno
- constructEventAsync is the correct method for non-Node runtimes
- Also deployed payment-webhook with --no-verify-jwt (required for external webhooks)"
```
