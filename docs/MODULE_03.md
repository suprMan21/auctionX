# Module 03 — Auction Orchestration & Application Services

## Goal
Introduce an orchestration layer that coordinates:
- repository reads
- mechanics execution (pure, deterministic)
- patch application (optimistic concurrency + preconditions)
- structured logging at orchestration boundaries
- domain-aware error propagation

## Non-negotiables
- No business logic duplicated from mechanics
- Mechanics outputs are immutable artifacts
- All writes guarded by expectedVersion + preconditions
- Zod validation at orchestration inputs and outputs
- Deterministic behavior preserved end-to-end
- Logging must not affect outcomes
- Testable without Firebase emulator

## Layer responsibilities
### Mechanics (Module 02)
- Pure deterministic functions
- Return `{ patch, preconditions }` (and optional `noop`)
- No logging, no IO, no side effects

### Repositories (Module 01)
- Persistence-only
- Validate all reads/writes
- Apply patches with concurrency + preconditions enforcement
- No logging

### Orchestration (Module 03)
- Load domain objects from repos
- Validate orchestration inputs (Zod)
- Invoke mechanics
- Validate mechanics outputs (Zod)
- Apply patch via repos with `expectedVersion` + `preconditions`
- Emit structured logs (attempt + terminal outcome)
- Map errors into stable orchestration error codes

## Optimistic concurrency strategy
- Repo read returns `{ value, version }`
- Orchestration calls `applyPatch(auctionId, { expectedVersion, preconditions, patch })`
- Repo enforces version match and re-checks preconditions against current stored state

## Logging taxonomy
Events:
- `orch.<op>.attempt`
- `orch.<op>.success`
- `orch.<op>.noop`
- `orch.<op>.validation_failed`
- `orch.<op>.not_found`
- `orch.<op>.precondition_failed`
- `orch.<op>.version_conflict`
- `orch.<op>.repo_error`
- `orch.<op>.unexpected_error`

Payload (minimum):
- requestId, op, aggregate
- domain IDs (auctionId, listingId, bidId, actorId where applicable)
- outcome classification
- durationMs
- optional patchSummary
- optional error { code, message }

## Error propagation model
Orchestration error codes:
- VALIDATION_FAILED
- NOT_FOUND
- PRECONDITION_FAILED
- VERSION_CONFLICT
- REPOSITORY_ERROR
- UNEXPECTED_ERROR

These map cleanly later into the standard API error model:
`{ code, message, details?, requestId }`

## Unit-test strategy (no emulator)
- Orchestrators depend on repo ports (interfaces) + logger interface
- Use mocked repos to simulate:
  - not found
  - version conflicts
  - precondition failures
  - repo errors
- Assert deterministic outcomes and that logging is attempted (but ignored on logger failure)
- Verify mechanics outputs are not mutated (freeze in tests)

## Lessons Learned (for Main Chat #00)
- Orchestration is the only place where coordination + observability live.
- Mechanics outputs are immutable artifacts; orchestration validates and applies them.
- Repo `applyPatch` is the single write gateway with expectedVersion + preconditions.
- Logging is outcome-based and must never affect control flow.
