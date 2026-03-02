# MODULE 06 — Post-Auction Settlement (Payment-Agnostic)

## Purpose

Module 06 introduces a **Settlement** lifecycle that begins after an auction is closed and before any payment provider is involved.

The goal is to:
- decouple auction mechanics from money movement
- preserve deterministic price and winner invariants
- provide a stable, provider-agnostic bridge for future payment, payout, and dispute modules

This module is intentionally **Stripe-free**.

---

## Authoritative Inputs

Settlement creation consumes **only authoritative close data**:

- `AuctionState.close.winnerUid`
- `AuctionState.close.winningPriceCents`
- `AuctionState.close.reason`
- `AuctionState.close.closedAtMs`

### Locked invariants
- Final price **must** come from `AuctionState.close.winningPriceCents`
- Auction meta pricing fields must not be read after close
- If `winnerUid` is null or `reason === NO_BIDS`, settlement is voided

---

## Settlement Outcomes

| Condition | outcomeKind | status | actions |
|---------|-------------|--------|---------|
| No bids / no winner | `NO_BIDS` | `VOIDED` | none |
| Winner at close | `PAYMENT_REQUIRED` | `ACTION_REQUIRED` | `COLLECT_AND_PAY` |

---

## Settlement Lifecycle

### States
- `CREATED`
- `ACTION_REQUIRED`
- `IN_PROGRESS`
- `FAILED_RETRYABLE`
- `FAILED_TERMINAL`
- `SETTLED`
- `VOIDED`

### Terminal states
- `SETTLED`
- `VOIDED`
- `FAILED_TERMINAL`

### Transition rules
- `ACTION_REQUIRED → IN_PROGRESS`
- `IN_PROGRESS → FAILED_RETRYABLE → IN_PROGRESS`
- `IN_PROGRESS → SETTLED`
- Any state → `VOIDED` (explicit operation)

---

## Provider-Agnostic Actions

Settlement produces **declarative actions**, not provider logic.

Current action:
- `COLLECT_AND_PAY`

Actions:
- are typed
- track attempts
- carry status independently of settlement status
- are consumed by future modules (Payments, Payouts, Disputes)

---

## Orchestration Contracts

All settlement orchestration entrypoints are:

- **Idempotent**
  - keyed by `requestId`
- **Optimistic-concurrency-safe**
  - optional `expectedVersion`
- **Orchestration-only logging**
  - no logging in mechanics or repos

### Canonical log fields
- `requestId`
- `op`
- `aggregate = settlement`
- `listingId`
- `auctionId`
- `outcome`
- `durationMs`
- `expectedVersion` (when applicable)

---

## Persistence Surface

- Collection: `settlements`
- Document ID: `settlementId === auctionId`

### Rationale
- Enforces one settlement per auction close
- Simplifies idempotent creation
- Avoids cascading lookup surfaces

---

## Validation & Gates

### Settlement Gate
- `scripts/settlementGate.ts`
- Scenarios:
  - 2 bidders
  - 3 bidders
  - no bids
- Validates:
  - lifecycle transitions
  - retry behavior
  - optimistic concurrency
- Gate wipes settlement docs per scenario to avoid stale persistence

### Postflight Gate (required)
- `scripts/postflightGate.ts`
- Runs:
  - build
  - preflightGate
  - settlementGate
- Module may only be locked if:
  - `POSTFLIGHT GATE: PASS`

---

## Non-Goals (Explicitly Out of Scope)

- Stripe or any payment provider integration
- Authorization or capture logic
- Payouts, fees, or tax remittance
- Disputes, refunds, or chargebacks
- Background schedulers or triggers
- UI concerns

---

## Module Status

**LOCKED**

All invariants enforced.  
All gates passing.  
Ready for Module 07 — Payments & Authorization.
