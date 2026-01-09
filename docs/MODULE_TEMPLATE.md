# MODULE TEMPLATE

Use this template to document each module. Keep it concise, concrete, and reproducible.

---

## Module ID and Name
- **Module:** XX — <Name>
- **Branch:** <branch>
- **Date:** <YYYY-MM-DD>

---

## Locked Inputs and Assumptions
- List assumptions this module relied on.
- List constraints (e.g., “No refactors to prior modules”).

---

## Goals
- What this module was intended to achieve.
- What success looks like at the end of the module.

---

## Scope

### In
- Explicitly list what is included in this module.

### Out
- Explicitly list what is excluded and deferred to later modules.

---

## Repo Touchpoints
- **Primary folders/files:**
  - `functions/src/...`
  - `docs/...`
- **No-go zones (immutable modules):**
  - List modules or folders that must not be modified.

---

## Architecture Notes
- Key design decisions.
- Why certain approaches were chosen.
- Notes on determinism, testability, and separation of concerns.

---

## Deliverables
List each deliverable and where it lives in the repo.

---

## Validation Steps
Provide copy-pasteable commands used to validate the module.

Example: