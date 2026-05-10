# Phase 7D: Stripe Connect Onboarding — Verification Report

**Date:** 2026-05-09
**Phase:** 7D — Stripe Connect Express onboarding + real Transfer execution
**Status:** CODE COMPLETE — pending Stripe dashboard webhook + 1Password secret population for live test
**Branch:** `feature/phase-7d-stripe-connect`

---

## Build Status

| Check | Status |
|-------|--------|
| `frontend npx tsc --noEmit` | ✅ 0 errors |
| `backend  npx tsc --noEmit` | ✅ 0 errors |
| `backend  npx vitest run`   | ✅ 4 files / 33 tests (12 passed, 21 skipped on missing env), incl. 8 new |
| Migration `20260510000001_stripe_connect.sql` applied to `pmlofthmobglcfkqjtru` | ✅ via `mcp apply_migration` |
| Edge function `release-escrow` v7 ACTIVE on `pmlofthmobglcfkqjtru` | ✅ via `mcp deploy_edge_function` (verify_jwt: true) |

---

## Files Created

| File | Purpose |
|------|---------|
| `supabase/migrations/20260510000001_stripe_connect.sql` | Adds 4 cols to `users` + `stripe_transfer_id` on `payouts` + partial index |
| `supabase/functions/_shared/payment/stripeClient.ts` | Singleton Stripe SDK helper for edge functions |
| `backend/src/lib/stripe.ts` | Singleton Stripe SDK helper for backend |
| `backend/src/controllers/stripeConnectController.ts` | `createOnboardingLink`, `getConnectStatus`, `applyAccountUpdate` |
| `backend/src/routes/stripeConnect.ts` | `POST /onboarding-link`, `GET /status` (auth required) |
| `backend/src/routes/stripeAccountWebhook.ts` | `POST /` for `account.updated` (raw body, signed) |
| `backend/src/__tests__/stripeConnect.test.ts` | 8 vitest cases — controller logic + webhook helper |
| `frontend/src/pages/SettingsPayoutsPage.tsx` | 4-state Connect onboarding UI (`/settings/payouts`) |

## Files Modified

| File | Change |
|------|--------|
| `supabase/functions/release-escrow/index.ts` | Replaced Transfer stub (lines 168–191) with real `stripe.transfers.create()` gated on processor + seller onboarding; idempotency-keyed by payout id |
| `backend/src/server.ts` | Mounts Stripe Connect routes; mounts `/api/v1/webhooks/stripe-account` with `express.raw()` BEFORE `express.json()` so signature verification gets raw body |
| `backend/.env.op` | Adds `STRIPE_CONNECT_WEBHOOK_SECRET=op://AM_Development/Stripe/connect-webhook-secret` |
| `backend/src/types/database.types.ts` + `frontend/src/types/database.types.ts` | Regenerated against prod schema (~2622 lines, includes `stripe_connect_*` + `stripe_transfer_id`) |
| `frontend/src/lib/api.ts` | Adds `api.stripeConnect.{getStatus, createOnboardingLink}` + exported `StripeConnectStatus` type |
| `frontend/src/App.tsx` | Adds `/settings/payouts` protected route |
| `docs/TODO.md` | Marks the Transfer-stub TODO complete; logs the remaining Stripe webhook secret action |

---

## New API Surface

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/v1/stripe-connect/onboarding-link` | Required | Creates Express account if missing, returns fresh Account Link URL |
| GET  | `/api/v1/stripe-connect/status`          | Required | Returns `{ status, accountId, chargesEnabled, payoutsEnabled, disabledReason, onboardingStartedAt }`; lazy-refreshes from Stripe if local flags are stale |
| POST | `/api/v1/webhooks/stripe-account`        | Stripe signature | Handles `account.updated` → flips `users.stripe_connect_charges_enabled` / `_payouts_enabled` |

Status state machine (derived in controller):
- `not_started` — no `stripe_connect_account_id`
- `pending` — has account_id, both flags false, no `disabled_reason`
- `active` — both flags true
- `restricted` — both flags false AND `requirements.disabled_reason` is set

---

## Out of Scope (intentional)

- Changing `process-payment` / `StripeProcessor` — separate-charges-and-transfers preserves the existing buyer-side charge on the platform account.
- NSFW listing routing / dual-storefront UX — handled at the listing review layer in a future phase. Any seller can complete Connect onboarding; whether the Transfer fires depends on `transactions.successful_processor`.
- Non-Stripe processor payouts (NOWPayments, PaymentCloud, Signature, CCBill) — payouts stay PENDING until a processor-specific payout flow is built.
- pg_cron wiring for `release-escrow` — separately tracked in `docs/TODO.md` (already a HIGH-priority item).
- Production env-var rotation on App Runner — separately tracked in CLAUDE.md "Pending" list.

---

## Manual Smoke Test (post-deploy, requires Stripe test-mode + webhook setup)

Pre-reqs:
1. Fill `op://AM_Development/Stripe/connect-webhook-secret` in 1Password vault.
2. Stripe Dashboard → Connect → enable Express.
3. Stripe Dashboard → Developers → Webhooks → add endpoint for **Connected accounts** events targeting `https://vw7zy9mkyg.us-east-2.awsapprunner.com/api/v1/webhooks/stripe-account`, subscribe to `account.updated`.
4. For local dev: `stripe listen --forward-connect-to localhost:3001/api/v1/webhooks/stripe-account` and copy the signing secret into the local `.env`.

Steps:
1. **Onboarding** — log in as `test@authentic-materials.com` → `/settings/payouts` → click Connect. Use Stripe test individual (`000-00-0000` SSN, routing `110000000`, account `000123456789`). Confirm redirect back with `?return=1`.
2. **Webhook delivery** — confirm `account.updated` is delivered, both `stripe_connect_charges_enabled` and `_payouts_enabled` flip to `TRUE`, badge turns green on next page load.
3. **End-to-end Transfer** — seed a settlement with `escrow_ends_at` in the past via `mcp execute_sql`, then trigger `release-escrow` with `x-release-secret` header. Confirm: `payouts.status='PROCESSING'`, `payouts.stripe_transfer_id` populated, Stripe Dashboard → Connect → Transfers shows the test transfer.
4. **Idempotency** — re-trigger `release-escrow` for the same settlement, confirm no duplicate transfer (Stripe returns the original via the idempotency key).
5. **Negative path** — second seller without `stripe_connect_account_id` settles their escrow, confirm payout stays `PENDING` and log emits `Transfer skipped — pending processor or onboarding`.

---

## Lessons + Decisions

- Lesson: [Stripe Express uses Account Links, not OAuth — STRIPE_CONNECT_CLIENT_ID not needed](https://www.notion.so/35c3baf696648139b6d7f03310c2c05f)
- Lesson: [supabase MCP generate_typescript_types returns JSON-wrapped output](https://www.notion.so/35c3baf6966481f6b209cb0148ad1881)
- Lesson: [supabase MCP deploy_edge_function: bundle shared deps with project-relative paths](https://www.notion.so/35c3baf69664816dbfd3fbc0dc3bc021)
- Decision: [Phase 7D — Stripe Connect Express for marketplace seller payouts](https://www.notion.so/35c3baf6966481d6a61cdd4a9e1fe036)
