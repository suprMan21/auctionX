# MODULE 03 — Auction Orchestration & Application Services

## 🔭 Forward-Compatibility Scan (MANDATORY)

**Purpose:** Before implementation, identify small, low-cascade changes to prior modules that could significantly reduce rework in upcoming modules — **without violating immutability unless explicitly approved**.

### 1️⃣ Upcoming Modules Considered
- Module 04: API endpoints/handlers for auction actions (place bid, start, close)
- Module 05: Payments + settlement coordination (Stripe capture window, offer cascading)
- Module 06: Triggers/schedulers (auction start/close scheduling, retries, outbox patterns)

### 2️⃣ Forward-Compat Candidates (Optional Changes)

**Candidate:** Introduce a separate mutable `AuctionState` persistence shape  
- **Affected module(s):** Module 01/03 boundary (new domain schema + repo), future modules 04–06
- **Why this helps later:** Mechanics require pricing/proxy/version state; keeping `Auction` lean avoids query bloat and prevents schema drift
- **Cascade risk:** Low (new doc only; no changes to existing schemas)
- **Decision:** ✅ Approved and implemented (new `AuctionState` doc)

**Candidate:** Enforce “No Guessing Schema” as a hard rule  
- **Affected module(s):** All
- **Why this helps later:** Prevents hidden mismatches between mechanics aggregates and persisted domain shapes
- **Cascade risk:** Low (process rule)
- **Decision:** ✅ Approved and implemented (lessons learned)

### 3️⃣ Immutable Confirmation
☑ No prior modules were modified during implementation  
☑ Approved forward-compat changes were added as **new** surfaces only (schemas/repos)  
☑ Current module proceeds assuming prior modules remain locked

### 4️⃣ STOP-AND-ASK Gate
Implementation began only after:
- Forward-compat candidates were reviewed
- Approval was explicit
- Scope was locked

---

## Context and Goal

Module 03 introduces an orchestration layer that coordinates:
- repository reads
- pure/deterministic auction mechanics execution
- transactional patch application using optimistic concurrency
- structured logging at orchestration boundaries
- domain-aware error mapping

**Non-goals (explicitly out of scope):**
- HTTP handlers/routes
- Firestore triggers
- Payment lifecycle / Stripe logic
- UI concerns
- Refactors to prior modules

---

## Architecture Summary

### Layers (Separation of Concerns)

**Mechanics (pure)**
- deterministic functions
- no IO, no logging
- takes `{ nowMs }` explicitly
- returns `{ preconditions, patch }`

**Orchestration (coordination)**
- validates inputs/outputs with Zod
- loads aggregate state from repositories
- calls mechanics
- applies patch via transactional persistence
- logs attempt/outcome/failure with canonical structure
- maps errors into domain-aware orchestration errors

**Persistence (IO only)**
- reads/writes Firestore
- validates read/write shapes with Zod
- enforces optimistic concurrency in transactions (expectedVersion)

---

## Data Model Additions

### Auction (existing, persistence-only)
Path:
- `listings/{listingId}/auctions/{auctionId}`

Stores:
- schedule (Timestamp)
- status
- close metadata
- snapshot fields for feed queries
- base meta (id/createdAt/updatedAt)

### AuctionState (new, mutable mechanics state)
Path:
- `listings/{listingId}/auctions/{auctionId}/state/current`

Stores:
- `version` (optimistic concurrency token)
- `updatedAtMs` (mechanics clock in ms)
- `pricing` (startPriceCents/currentPriceCents)
- `proxy` (high bidder uid/max; second-highest max)
- `close` (winnerUid/winningPriceCents/closedAtMs/reason)

Rationale:
- preserves a lean `Auction` doc for query/feed concerns
- provides a correct persistence target for `AuctionCore` mechanics state
- avoids overloading or mutating historical auction snapshots

---

## Orchestration Flow

### placeBid

1) Validate command input (`listingId`, `auctionId`, `bidderUserId`, `amountCents`, `nowMs`)
2) Load `Auction` + `AuctionState` and assemble `AuctionCore`
3) Invoke mechanics `computePlaceBid({ auction, input, nowMs })`
4) Validate mechanics output (`preconditions`, `patch`)
5) Apply patch transactionally:
   - enforce `AuctionState.version === expectedVersion`
   - apply patch to AuctionState (version bump and state changes)
   - update Auction metadata (status/close only) for query friendliness
6) Return updated `AuctionCore`
7) Emit structured logs (attempt/success/failure) without affecting control flow

---

## Optimistic Concurrency Strategy

- **Concurrency token:** `AuctionState.version` (integer)
- Mechanics preconditions include:
  - `auctionId`
  - `expectedVersion` (must match `AuctionState.version` at apply time)
- Apply occurs in a Firestore transaction:
  - read Auction + AuctionState
  - if version mismatch → throw `VERSION_CONFLICT`
  - write updated AuctionState (version + patch)
  - write updated Auction (metadata only)

**Guarantee:** patch application is atomic and guarded.

---

## Logging Taxonomy

Logging occurs only at orchestration boundaries.

### Event names
Pattern:
- `auction.placeBid.attempt`
- `auction.placeBid.success`
- `auction.placeBid.validation_failed`
- `auction.placeBid.not_found`
- `auction.placeBid.precondition_failed`
- `auction.placeBid.version_conflict`
- `auction.placeBid.repo_error`

### Canonical payload
All logs include:
- `requestId`
- `op`
- `aggregate`
- `listingId`
- `auctionId`
- `actorId`
- `outcome` classification
- `expectedVersion` (when relevant)
- `durationMs` (must not affect control flow)
- `error: { code, message }` when failure

---

## Error Propagation Model

### Mechanics → Orchestration
Mechanics errors are treated as deterministic, domain-specific rejections and mapped into orchestration errors:
- e.g., `BID_MUST_BE_AT_LEAST_NEXT_INCREMENT` → orchestration `PRECONDITION_FAILED` (with details)

### Persistence → Orchestration
Repository transactional apply surfaces these stable error codes:
- `NOT_FOUND`
- `VERSION_CONFLICT`
- `PRECONDITION_FAILED`
- `REPOSITORY_ERROR`

Orchestration maps them into domain-aware errors while preserving details.

---

## Unit Test Strategy (No Emulator)

- Orchestration is designed to be testable with mocked repo ports and a mocked logger (no Firebase emulator).
- The `src/v1/services/orchestration/__tests__/` directory is intentionally present but empty in Module 03.
- Orchestration test cases are **deferred to Module 04** when HTTP handlers stabilize the public command shapes.
  - At that point we will add:
    - success path control-flow tests (read → mechanics → apply)
    - version conflict mapping tests (`VERSION_CONFLICT`)
    - not-found mapping tests (`NOT_FOUND`)
    - validation failure mapping tests (`VALIDATION_FAILED`)

## Deliverables Checklist

1) Orchestration service definitions ✅  
2) Repo → mechanics → patch → repo flow ✅  
3) Optimistic concurrency strategy ✅  
4) Logging taxonomy/payload ✅  
5) Error propagation model ✅  
6) Unit-test strategy ✅  
7) Documentation update ✅  
8) Lessons Learned for reintegration ✅  

---

## Lessons Learned

### No-Guessing Schema Rule (LOCKED)
Never infer persisted field shape from mechanics types. Always inspect the authoritative Zod persistence schema and build explicit mappings. TypeScript errors are treated as architectural signals.

### Derived Aggregate ≠ Persistence Shape (LOCKED)
`AuctionCore` is a derived aggregate used by mechanics; it is not the same as persisted `Auction`. Mutable bidding state must live in `AuctionState`, not in `Auction`.

### Forward-Compatibility Planning (LOCKED)
Before implementing a module, scan upcoming modules and propose low-cascade optional improvements as “Forward-Compat Candidates” before scope is locked.

