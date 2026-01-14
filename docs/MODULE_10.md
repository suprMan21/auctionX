# Module 10 — Admin Overrides & Manual Intervention (Provider-Agnostic Core) — LOCKED

## Purpose
Introduce a provider-neutral, heavily-audited admin intervention layer for exceptional situations (fraud, safety, operational recovery) across core aggregates without modifying existing locked modules or leaking provider concepts into domain models.

## Hard invariants preserved
- Provider neutrality: all admin outcomes are recorded as **facts** (no provider objects).
- Orchestrator purity: explicit parameters only (no env fallbacks for IDs).
- requestId idempotency: deterministic adminActionId derived from requestId.
- expectedVersion concurrency: required on versioned mutations (e.g., dispute chargeback fact).
- Mechanics and repositories remain silent (no new logging in those layers).
- Orchestration logs only at orchestration boundaries using canonical fields.

## What shipped

### 1) AdminAction audit model (immutable audit trail)
- Added `AdminAction` schema + types in:
  - `src/v1/schemas/domain/admin/adminAction.schema.ts`
- Admin actions capture:
  - actionKind
  - reasonCode
  - actor (HUMAN or SYSTEM)
  - justification (required)
  - requestId (required)
  - expectedVersion (optional, required where applicable)
  - target (aggregate identifiers)
  - optional caseId and pre/post explain snapshots
  - status + result + optional failure

### 2) AdminAction persistence (approved new surface)
- Added repo:
  - `src/v1/repos/adminActions.repo.ts`
- Deterministic doc ID:
  - `admin_<requestId>` for idempotent createIfAbsent without secondary lookup surfaces.

### 3) Admin orchestrator entrypoints (safe wrappers)
- Added orchestration layer:
  - `src/v1/services/orchestration/admin.orchestrator.ts`
- Implemented minimal MVP actions used by gate:
  - `createDisputeAdmin(...)` (creates dispute via DisputeOrchestrator + records AdminAction)
  - `recordChargebackFactAdmin(...)` (records dispute chargeback fact + records AdminAction)

### 4) Admin gate (lean + rerunnable) integrated into postflight
- Added:
  - `scripts/adminGate.ts`
- Integrated into postflight step chain:
  - `scripts/postflightGate.ts` runs `adminGate.ts` and requires `ADMIN GATE: PASS`
- The gate proves:
  - AdminAction idempotency (re-run results in noop with APPLIED result)
  - Admin wrappers correctly invoke underlying orchestrators
  - expectedVersion concurrency is respected on dispute mutation

## Testing / Verification
### Required gates
- `npm run gate:preflight` → `PREFLIGHT GATE: PASS`
- `npm run gate:postflight` → `POSTFLIGHT GATE: PASS`
  - Includes `ADMIN GATE: PASS`

## Lessons Learned
- Deterministic AdminAction IDs (`admin_<requestId>`) avoid extra persistence/index surfaces while preserving idempotency.
- Keep gates provider-neutral: record outcomes as facts (e.g., chargeback reported) rather than provider artifacts.
- Prefer direct emulator reads in gates when repo read APIs are intentionally minimal; validate via schema parsing to avoid “schema guessing”.
- Admin intervention must remain orchestration-only: no repo hacks, no mechanics mutations.

## Follow-ups (explicitly out of scope for Module 10)
- Admin UI and operator tooling
- Role/permission enforcement changes
- Background schedulers / webhooks
- Broader admin action catalog expansion beyond minimal MVP
