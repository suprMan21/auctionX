# DOCUMENTATION STANDARD — Append to Every Module Prompt

## Required Documentation (Do NOT skip these)

Every module session must produce the following documentation artifacts before committing. These are NOT optional.

### 1. Verification Report
**File:** `docs/MODULE_{XX}_VERIFICATION.md`

```markdown
# Module {XX}: {Name} — Verification Report

**Date:** {date}
**Session:** {module number}
**Commit:** {hash}

## Build Status
- Frontend TypeScript: {0 errors / N errors}
- Backend TypeScript: {0 errors / N errors}
- Production build: {PASS / FAIL} ({module count}, {time})

## Files Created
| File | Purpose |
|------|---------|
| path/to/file.tsx | One-line description |

## Files Modified
| File | What Changed |
|------|-------------|
| path/to/file.tsx | One-line description of change |

## Routes Added
| Route | Component | Auth Required |
|-------|-----------|---------------|
| /path | ComponentName | Yes/No |

## Manual Test Results
- [ ] Test 1 description — PASS/FAIL
- [ ] Test 2 description — PASS/FAIL

## Known Gaps
- Anything intentionally deferred, with reason
```

### 2. In-Code Documentation

**Every new file** must have a top-of-file doc comment:
```typescript
/**
 * BrowsePage — Main browse/discovery interface for listings
 * 
 * Routes: /browse, /browse/:categorySlug
 * Queries: listings (with auctions + listing_media joins), categories
 * Dependencies: ListingCard, formatPrice, timeRemaining
 * 
 * @module Module 06 — Browse & Search
 */
```

**Every exported function** must have a JSDoc comment:
```typescript
/**
 * Formats a price in cents to a localized currency string.
 * @param cents - Price in cents (e.g., 12500 = $125.00)
 * @param currency - ISO currency code, defaults to 'CAD'
 * @returns Formatted string (e.g., "$125.00")
 */
export function formatPrice(cents: number, currency: 'CAD' | 'USD' = 'CAD'): string {
```

**Every component** must have a props doc:
```typescript
/**
 * ListingCard — Displays a listing in browse/search grids
 * 
 * Shows first image, title, current bid, time remaining.
 * Links to auction detail page.
 * 
 * @module Module 06 — Browse & Search
 */
interface ListingCardProps {
  /** The listing with joined auction and media data */
  listing: ListingWithAuction;
}
```

**Complex logic** must have inline comments explaining WHY, not WHAT:
```typescript
// Use highest individual flag score, not sum — a single HIGH flag
// overrides any number of LOW flags (compliance requirement)
const maxScore = Math.max(...contentFlags.map(f => FLAG_SCORES[f] ?? 0), 0);
```

### 3. TODO Tracking
**File:** `docs/TODO.md` (append to existing, create if not exists)

Every known gap, deferred decision, or future improvement must be logged:
```markdown
## Module {XX}: {Name}
- [ ] **TODO:** Description of what needs doing
  - Context: Why it was deferred
  - Priority: LOW / MEDIUM / HIGH
  - Depends on: Module {YY} or "standalone"
```

### 4. Lessons Learned

**Single source of truth:** [`docs/MASTER_LESSONS_LEARNED.md`](MASTER_LESSONS_LEARNED.md)

After completing a module:
1. Add any **cross-cutting patterns, gotchas, or rules** to the appropriate section of `MASTER_LESSONS_LEARNED.md`
2. Add new gotchas to the **Section 10 quick-reference table**

**Archive (optional):** `docs/LESSONS_LEARNED.md` retains per-module session history (what worked, what didn't, time estimates). This is for historical reference only — `MASTER_LESSONS_LEARNED.md` is the mandatory pre-module review.

---

## Enforcement

The commit step should NOT happen until all documentation artifacts are complete:
0. ✅ `docs/MASTER_LESSONS_LEARNED.md` reviewed before starting (mandatory)
1. ✅ `docs/MODULE_{XX}_VERIFICATION.md` exists and is filled out
2. ✅ All new files have top-of-file doc comments
3. ✅ All exported functions have JSDoc
4. ✅ `docs/TODO.md` updated (even if just "No new TODOs")
5. ✅ `docs/MASTER_LESSONS_LEARNED.md` updated with any new cross-cutting lessons or gotchas

**Only then:**
```bash
git add -A
git commit -m "feat: Module {XX} — {description}"
```
