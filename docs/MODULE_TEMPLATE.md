# MODULE TEMPLATE

## 🔭 Forward-Compatibility Scan (MANDATORY)

**Purpose:** Before implementation, identify small, low-cascade changes to prior modules that could significantly reduce rework in upcoming modules — **without violating immutability unless explicitly approved**.

### 1️⃣ Upcoming Modules Considered
_List the next 2–4 modules that will consume or depend on this module._

- Module N+1:
- Module N+2:
- Module N+3 (if applicable):

### 2️⃣ Forward-Compat Candidates (Optional Changes)
_Only include candidates that are **small, localized, and low-cascade**._

For each candidate:

**Candidate:**  
_One-line description_

- **Affected module(s):**
- **Why this helps later:**
- **Cascade risk:** Low / Medium / High
- **Decision:** ⬜ Defer ⬜ Approve ⬜ Reject

> ⚠️ High-cascade items are documented but **never approved** during this phase.

### 3️⃣ Immutable Confirmation
☑ No prior modules will be modified unless explicitly approved above  
☑ If approved, changes will be isolated, documented, and committed separately  
☑ Current module proceeds assuming prior modules remain locked

### 4️⃣ STOP-AND-ASK Gate
Implementation **does not begin** until:
- Forward-compat candidates are reviewed
- Approval or rejection is explicitly confirmed
- Scope is locked


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