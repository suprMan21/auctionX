# Module 07 — Payments & Authorization (Stripe) — LOCK CANDIDATE

## Goal
Implement Stripe authorization + capture to satisfy the Settlement action `COLLECT_AND_PAY` **without** leaking Stripe concepts into domain models.

## Non-Negotiables (Respected)
- Settlement semantics unchanged (Module 06 remains authoritative).
- Settlement consumes authoritative close data only:
  - `winnerUid`
  - `winningPriceCents`
- No use of auction meta pricing fields post-close.
- Idempotency via `requestId`.
- Optimistic concurrency via `expectedVersion`.
- No logging inside mechanics or repositories.
- Orchestration owns logging.
- No new persistence surfaces.
- Emulator-first validation gates required.

## What Shipped

### 1) Stripe adapter boundary (containerized)
New provider-neutral contract:
- `functions/src/v1/payments/paymentProvider.ts`

Stripe implementation:
- `functions/src/v1/payments/stripe/stripe.provider.ts`
- `functions/src/v1/payments/stripe/stripe.errors.ts`

Key properties:
- Uses Stripe `PaymentIntent` with `capture_method: "manual"` then capture immediately.
- Stripe idempotency keys derived from `{settlementId}:{AUTH|CAPTURE}:{requestId}`.
- No Stripe fields persisted into settlement documents (provider IDs remain outside domain).

### 2) Orchestration integration (COLLECT_AND_PAY)
New orchestration entrypoint:
- `orchCollectAndPay(...)` in `functions/src/v1/services/orchestration/settlement.orchestrator.ts`

Flow:
1. Read settlement (must be `PAYMENT_REQUIRED` + action `COLLECT_AND_PAY`).
2. Start settlement via existing Module 06 mutation (`orchStartSettlement`) using `expectedVersion`.
3. Call Stripe provider `authorizeAndCapture(...)` (idempotent).
4. On success: mark settled via `orchMarkSettlementSettled` using next version.
5. On failure: classify retryable vs terminal via `mapStripeError` and record via `orchRecordSettlementFailure`.

### 3) Failure classification (retryable vs terminal)
`mapStripeError` classifies:
- Terminal: card declines, invalid request, auth errors
- Retryable: rate limits, API errors, connection issues, unknowns default retryable

### 4) Emulator-first gates
New scripts:
- `functions/scripts/stripeGate.ts` (Stripe connectivity + manual capture)
- `functions/scripts/paymentGate.ts` (end-to-end: preflight-seeded close → create settlement → collectAndPay → assert SETTLED)

Postflight updated:
- `functions/scripts/postflightGate.ts` now includes `paymentGate` step.

## Security Posture
- No card data stored or processed by Firestore/Functions.
- Gate uses Stripe test PM reference (`pm_card_visa`) and Stripe test secret key.
- Secrets kept in `.env.local` (gitignored).
- Settlement remains provider-agnostic and stores no Stripe identifiers.

## How To Run

### Stripe gate
- Requires `STRIPE_SECRET_KEY` (test) and `STRIPE_CURRENCY`.
- `npx ts-node ./scripts/stripeGate.ts`

### Payment gate (end-to-end)
- Requires emulator env vars + Stripe env vars.
- `npx ts-node ./scripts/preflightGate.ts`
- `npx ts-node ./scripts/paymentGate.ts`

### Postflight
- `npm run postflight`
- Must end with `POSTFLIGHT GATE: PASS`

## Forward-Compat Notes (Modules 08–10)
- No persistence changes were introduced; provider IDs are intentionally not stored.
- If future payouts/disputes require provider identifiers, add a provider-owned persistence surface later (STOP-AND-ASK required).
- Current design keeps Stripe fully swappable by isolating it behind `PaymentProvider`.
