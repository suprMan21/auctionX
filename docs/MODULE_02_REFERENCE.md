# MODULE 02 — Auction Mechanics & State Transitions

## Locked Inputs and Assumptions
- Modules 0, 0.5, and 01 are complete and immutable.
- Zod domain schemas are authoritative.
- Repositories are persistence-only (no business logic).
- No endpoints, payment capture, authorization changes, or UI concerns.
- Deterministic logic only: all time is injected as `nowMs`.

---

## Goal
Implement deterministic, unit-testable auction lifecycle behavior at the service layer, including:
- Auction state transitions
- Time-based behavior
- Bidding rules
- Proxy bidding logic (eBay-style max bids)
- Explicit invariant enforcement

---

## Scope

### In
- Auction lifecycle state machine
- Valid and invalid state transitions
- Proxy bidding model and repricing rules
- Service-layer enforcement of domain invariants
- Pure business logic testable without Firebase emulator

### Out
- API endpoints and handlers
- Firestore writes or schema changes
- Payment lifecycle and Stripe logic
- Listing snapshot mutation
- UI concerns

---

## Deliverables (Repo Locations)

1) **Auction state machine definition**
   - Defined conceptually in this document

2) **Service-layer logic**
   - `functions/src/v1/services/auctions/auction.mechanics.ts`
     - `computeStartAuction`
     - `computePlaceBid`
     - `computeCloseAuction`

3) **Proxy bidding rules**
   - `functions/src/v1/services/auctions/auction.proxy.ts`

4) **Domain invariants and errors**
   - `functions/src/v1/services/auctions/auction.invariants.ts`
   - `functions/src/v1/services/auctions/auction.errors.ts`

5) **Documentation**
   - `docs/MODULE_TEMPLATE.md`
   - `docs/MODULE_02_REFERENCE.md`

6) **Unit-testable validation**
   - `functions/src/v1/services/auctions/__tests__/run.ts`

---

## Auction State Machine

### States
- **SCHEDULED**
- **RUNNING**
- **CLOSED** (terminal)
- **VOIDED** (terminal; not fully exercised in mechanics yet)

### Valid Transitions
- `SCHEDULED → RUNNING`
  - When `nowMs >= startAtMs` AND `nowMs < endAtMs`
- `RUNNING → CLOSED`
  - When `nowMs >= endAtMs`

### Invalid Transitions
- Any transition from `CLOSED` or `VOIDED`
- Starting after the end time (explicitly rejected)
- Implicit transitions (all transitions must be explicit)

### Determinism Rules
- No `Date.now()` inside mechanics
- Caller injects `nowMs`
- Mechanics return a **patch + preconditions**, not side effects

---

## Proxy Bidding Model (eBay-Style)

Stored proxy state:
- `highBidderUid`
- `highBidderMaxCents`
- `secondHighestMaxCents`

Pricing rules:
- One bidder:
  - `currentPriceCents = startPriceCents`
- Two or more bidders:
  - `currentPriceCents = min(highMax, secondMax + increment(secondMax))`

Tie-break rule:
- If challenger max equals current high max, incumbent remains high bidder (deterministic tie resolution).

Minimum increments:
- Deterministic increment schedule defined in `auction.proxy.ts`
- Increment increases as price tiers increase.

---

## Core Domain Invariants
- Auction schedule must be valid (`endAtMs >= startAtMs`)
- Bids only allowed when:
  - `status === RUNNING`
  - `startAtMs <= nowMs < endAtMs`
- Bid max must be ≥ start price
- High bidder may not decrease their max
- Non-high bidders must bid at least the next valid increment
- `currentPriceCents` must never decrease

All invariant violations are returned as typed errors.

---

## Logging & Observability
- Mechanics functions are intentionally **pure** and contain **no logging**.
- Logging occurs in orchestration layers (handlers/services) where:
  - Request context exists
  - requestId is available
- This preserves determinism and keeps mechanics unit-testable.

---

## Lessons Learned

- npm scripts must be executed from the `functions/` directory; the repo root intentionally has no `package.json`.
- Missing directories can masquerade as logic or tooling errors; creating paths explicitly (`mkdir -p`) prevents cascading confusion.
- Pure mechanics functions (no logging, no I/O) dramatically simplify unit testing, reasoning, and future reuse.
- Logging is a side effect and belongs in orchestration layers, not in deterministic business logic.
- Returning **patch + preconditions** (instead of mutating state) cleanly separates business rules from persistence and prepares the system for optimistic concurrency.
- Introducing a generic `npm run test` alias improves developer ergonomics without expanding scope or coupling modules.
- Avoid large shell heredocs for documentation edits during active development; prefer editor-based updates or small, verifiable changes.

## Validation Steps