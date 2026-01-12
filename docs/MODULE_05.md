# MODULE_05.md — Auction Execution, Orchestration & Preflight Gate

## Module Status
**COMPLETE AND LOCKED**

Module 05 delivers the fully deterministic auction execution layer, validated end-to-end using a mandatory emulator preflight gate. All core auction mechanics have been exercised with no remaining functional defects.

---

## Module Goal
Implement and lock the behavioral core of the auction platform, including:
- Bid placement and proxy bidding
- Auction close logic
- Outcome determination
- Offer cascade execution
- Emulator-first verification
- Hard preflight gate enforcement

This module establishes trust in auction correctness before payments or UI layers are introduced.

---

## What Was Delivered

### 1. Auction Execution Mechanics
- eBay-style proxy bidding
- Deterministic price progression
- Optimistic concurrency via versioning
- Transactional Firestore updates

### 2. Aggregate Separation (Locked)
- **Auction (meta)**  
  Identity, schedule, snapshot, status, version
- **AuctionState (derived)**  
  Proxy bidding state, close info, outcome

Meta documents are not relied upon for computed price invariants after close.

---

### 3. Orchestration Layer
Explicit orchestrators for:
- `placeBid`
- `closeAuction`
- `advanceOfferCascade`

Each orchestrator:
- Is deterministic
- Uses optimistic locking
- Emits structured logs
- Returns typed outcomes

---

### 4. Structured Orchestration Logging (Canonical)
Every orchestration emits logs with:
- `requestId`
- `op`
- `aggregate`
- `listingId`
- `auctionId`
- `outcome` (attempt | success | error)
- `durationMs`
- `expectedVersion` (where applicable)

This format is now mandatory for all future modules.

---

### 5. Emulator-First Tooling
Supporting scripts were created to allow deterministic local validation:
- Listing and auction seed scripts
- Debug bid placement
- Bid dumping utilities
- Forced auction end and close scripts
- Offer cascade execution

All development and validation occurs against the Firebase emulator.

---

## Preflight Emulator Gate (HARD RULE)

A **mandatory preflight verification gate** is introduced and locked.

### Gate Script
`scripts/preflightGate.ts`

### Scenarios Enforced
1. **Two bidders**
   - Place bids
   - Close auction
   - Validate winner and winning price
   - Execute offer cascade
2. **Three bidders**
   - Validate proxy bidding order
   - Close auction
   - Validate cascade pricing and eligibility
3. **No bids**
   - Close auction
   - Validate `NO_BIDS`
   - Validate cascade returns `NO_ELIGIBLE_BIDDERS`

### Pass Criteria
- All scenarios execute without error
- Auction state reflects deterministic outcomes
- No reliance on missing meta pricing fields
- Firestore emulator configured exactly once
- Gate prints `PREFLIGHT GATE: PASS`

**This gate must pass and outputs must be recorded before any future module work proceeds.**

---

## Locked Decisions (Do Not Revisit)
- Emulator-first development
- Deterministic orchestration
- Proxy bidding model
- Auction + AuctionState separation
- Structured orchestration logging
- Preflight gate requirement
- No test framework dependency at this stage

---

## Known Non-Goals
Explicitly deferred:
- Payments
- Stripe integration
- Buyer acceptance flows
- Refunds or chargebacks
- UI concerns

These will be addressed in future modules.

---

## Forward Compatibility Notes
Module 05 intentionally preserves extension points for:
- Payment initiation from auction outcomes
- Offer acceptance workflows
- Relisting logic
- Admin force-close tooling
- Future test framework adoption (e.g., Jest)

No refactors are required to extend this module.

---

## Exit Criteria (Satisfied)
- Auction lifecycle fully implemented
- All edge cases validated
- Emulator preflight gate passing
- Logging discipline enforced
- Module documented and locked

**Module 05 is complete.**
