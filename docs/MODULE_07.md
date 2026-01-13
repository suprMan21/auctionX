# Module 07 — Stripe Integration (Payment + Payout Gates) — LOCKED

## Intent
Integrate Stripe payments into the post-auction settlement lifecycle without violating prior invariants:
- Post-close authority is the `AuctionState.close` block.
- Settlement remains the canonical lifecycle object after close.
- Orchestration stays idempotent and concurrency-safe.

## What shipped

### 1) Payment gate (Stripe)
- Added a payment path that validates environment requirements:
  - `FIRESTORE_EMULATOR_HOST`
  - `STRIPE_SECRET_KEY` (test key)
  - `STRIPE_CURRENCY` (cad)
- Implemented a `collectAndPay` orchestration flow that:
  - Starts settlement (if not already started)
  - Performs the payment step(s) (Stripe test-mode)
  - Marks settlement as `SETTLED`
- Payment gate added to `postflightGate.ts` as a required step.

### 2) Payout aggregate + payout gate
- Introduced a payout aggregate derived from settlement (not from listing meta pricing):
  - `grossAmountCents` comes from `winningPriceCents` via settlement
  - Fee and tax rulesets exist but currently resolve to zeroed/default behavior (MVP scaffolding)
- Implemented payout creation + release flow
- Added payout gate that:
  - Finds latest SETTLED settlement
  - Creates payout for settlementId
  - Releases payout
  - Re-runs create to validate idempotency
  - Reads back for sanity

### 3) Gates workflow hardened
- `postflightGate.ts` now includes settlement + payment + payout gates and asserts pass conditions.
- `.env.local` support is used by gates where applicable.
- Added convenience spinner shim for preflight command execution (quality-of-life only).

## Hard rules (reinforced / clarified)

### A) Post-close authority
Anything after close must use **only**:
- `close.winnerUid`
- `close.winningPriceCents`
Never read pricing from listing meta for settlement/payment/payout invariants.

### B) Orchestration discipline
All orchestration entrypoints that mutate aggregates must remain:
- idempotent (via requestId)
- version-checked (expectedVersion)
- transactionally safe

### C) Derived vs persisted
Payout amounts must be derived from authoritative settlement/close state.
Do not persist “duplicate truth” from listing meta.

## Test gates (required)

### Preflight
- Seed listing + auction
- Place bids (2/3 bidder scenarios)
- Close auction
- Advance offer cascade
- No-bids scenario

### Postflight
Includes all preflight scenarios plus:
- Settlement gate
- Payment gate
- Payout gate

Observed outcome in this lock:
- `PREFLIGHT GATE: PASS`
- `SETTLEMENT GATE: PASS`
- `PAYMENT GATE: PASS`
- `PAYOUT GATE: PASS`
- `POSTFLIGHT GATE: PASS` (exit 0)

## Forward-compat notes
- Disputes domain was intentionally **not** included in this module (removed from gate scope).
- Fee/tax rulesets are structured for future expansion but currently default to zero-impact for MVP.

