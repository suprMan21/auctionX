# Visual Review Pipeline — Implementation Plan

## Goal
Automated, repeatable visual design review of all 32 frontend routes with per-page AI assessments (using Claude vision) and a rollup report stored in Notion. Replaces the current `design-review/agent.ts` which only processes 5 routes and doesn't actually use vision for screenshots.

---

## Architecture Overview

```
Playwright (expanded visual.spec.ts)
  → Screenshots of all 32 routes (reports/screenshots/)
  → Axe a11y JSON per route

Skill 1: /review-screenshot
  → For each screenshot, calls Claude with vision (one at a time to avoid context bloat)
  → Produces per-page assessment JSON
  → Stores each as a Notion sub-page under a "Design Review Session" parent

Skill 2: /review-rollup
  → Reads all per-page assessments from Notion
  → Synthesizes final Design Suggestions report
  → Creates summary Notion page linking all sub-assessments
```

---

## Current State

### What Exists
- `scripts/tests/visual.spec.ts` — Tests 5 public routes, takes screenshots, runs axe
- `scripts/tests/smoke.spec.ts` — Tests 5 public routes + 2 gated redirects + API health
- `scripts/design-review/agent.ts` — Spawns `claude --print` with text prompt (screenshots passed as file paths, NOT as images — vision not used)
- `scripts/reports/screenshots/` — Stores PNG screenshots from visual tests
- Notion "Review Reports" database (`72ad5e90-1aec-47c5-b66c-9d54752ef3bd`) — Already exists, stores test run metrics

### Route Coverage Gap
- **Currently tested:** 5 routes (`/`, `/browse`, `/search?q=test`, `/login`, `/register`)
- **Missing:** 27 routes (all protected, admin, and dynamic public routes)
- **Total routes in App.tsx:** 32

### All Routes (from App.tsx)

**Public (no auth):**
- `/login`, `/register`, `/forgot-password`
- `/browse`, `/browse/:categorySlug`
- `/search` (with `?q=test`)
- `/listings/:id`, `/auctions/:id`, `/seller/:id`
- `/verify/:tokenName`

**Protected (auth required, Header shown):**
- `/profile`, `/my-listings`
- `/listings/create`, `/listings/:id/edit`
- `/verify/create/:verificationId`
- `/settlements/:settlementId`
- `/payouts`, `/saved-searches`
- `/messages`, `/messages/:conversationId`
- `/notifications`, `/settings/notifications`

**Admin (admin_users check):**
- `/admin`, `/admin/users`, `/admin/users/:id`
- `/admin/moderation`, `/admin/audit-logs`, `/admin/health`

---

## Step 1: Expand `visual.spec.ts`

### 1a. Route Registry
Create `scripts/tests/routes.ts` — single source of truth for all testable routes:

```typescript
export interface TestRoute {
  path: string;
  name: string;            // kebab-case, used as screenshot filename
  auth: 'none' | 'user' | 'admin';
  seedRequired?: boolean;  // needs test data (e.g., a listing ID)
  description: string;     // what this page shows
}

export const TEST_ROUTES: TestRoute[] = [
  // Public
  { path: '/', name: 'home', auth: 'none', description: 'Landing/redirect' },
  { path: '/login', name: 'login', auth: 'none', description: 'Login form' },
  { path: '/register', name: 'register', auth: 'none', description: 'Registration form' },
  { path: '/forgot-password', name: 'forgot-password', auth: 'none', description: 'Password reset' },
  { path: '/browse', name: 'browse', auth: 'none', description: 'Browse listings' },
  { path: '/search?q=test', name: 'search', auth: 'none', description: 'Search results' },
  // ... all 32 routes
];
```

When new routes are added to App.tsx, they get added here — one place to maintain.

### 1b. Auth Fixtures
In `scripts/tests/`, create a Playwright auth setup:
- `auth.setup.ts` — logs in with `PLAYWRIGHT_TEST_EMAIL`/`PLAYWRIGHT_TEST_PASSWORD`, saves storage state
- `admin-auth.setup.ts` — logs in with `PLAYWRIGHT_ADMIN_EMAIL`/`PLAYWRIGHT_ADMIN_PASSWORD`, saves admin storage state
- Update `playwright.config.ts` to add `setup` projects that run before `visual`

### 1c. Dynamic Route Seeding
For routes like `/listings/:id` and `/auctions/:id`:
- Query the staging API/Supabase for an existing listing/auction ID
- Fall back to a known test fixture ID
- Store in a shared fixture file that tests can import

### 1d. Screenshot Naming Convention
```
reports/screenshots/{name}-fullpage.png   # full scrollable page
reports/screenshots/{name}-viewport.png   # above-the-fold viewport
```
This already matches the current pattern — just extend to all routes.

### 1e. Per-Route Axe Results
Currently axe results are aggregated into one `axe-{timestamp}.json`. Keep that, but also output per-route results so Skill 1 can pair a screenshot with its specific violations:
```
reports/axe/{name}.json   # per-route axe result
```

---

## Step 2: Skill 1 — `/review-screenshot`

### Location
`.claude/commands/review-screenshot.md`

### Behavior
1. Scan `reports/screenshots/` for all `*-fullpage.png` files
2. For each screenshot:
   a. Read the image file (Claude Code can read images natively)
   b. Read the matching `reports/axe/{name}.json` if it exists
   c. Read the design system doc (`docs/DESIGN_SYSTEM.md`)
   d. Prompt Claude to assess the screenshot against the design system + a11y report
   e. Save the assessment as a JSON file in `reports/assessments/{name}.json`
   f. Create a Notion sub-page under the current review session page
3. Log progress: "Assessed 1/32: login ✔"

### Assessment JSON Shape
```typescript
interface PageAssessment {
  route: string;
  name: string;
  timestamp: string;
  scores: {
    designConsistency: number;    // 1-10
    accessibility: number;        // 1-10
    darkModeCompliance: number;   // 1-10
    responsiveness: number;       // 1-10
    overall: number;              // 1-10
  };
  issues: Array<{
    severity: 'critical' | 'high' | 'medium' | 'low';
    category: 'design' | 'a11y' | 'dark-mode' | 'layout' | 'typography' | 'interaction';
    description: string;
    recommendation: string;
    affectedElement?: string;     // CSS selector or component name if identifiable
  }>;
  positives: string[];            // things done well
  axeViolationCount: number;
  screenshotFile: string;
}
```

### Skill Prompt Template (for each screenshot)
```
You are reviewing a screenshot of the Authentic Materials web application.

## Design System Rules
- Dark mode only: bg #13131a (dark-800), #1a1a24 (dark-700)
- Primary: Purple gradient (#7c3aed → #3b82f6)
- Cards: Glassmorphism (backdrop-blur + border)
- Rounded corners: rounded-2xl for cards, rounded-xl for buttons
- WCAG 2.2 AA: 4.5:1 contrast minimum
- Font: system font stack

## Route: {route}
## Page: {description}

## Axe Violations for This Page:
{axe_json}

Review this screenshot and provide your assessment as JSON matching the PageAssessment schema.
Focus on:
1. Does it follow the dark mode design system?
2. Are there light-mode artifacts (white backgrounds, light grays)?
3. Is the glassmorphism consistent?
4. Typography hierarchy and readability
5. Button/input styling consistency
6. Spacing and alignment
7. Contrast and accessibility
```

### Key: One Screenshot at a Time
Each screenshot is processed in a separate Claude call to avoid context bloat. The skill iterates through screenshots sequentially.

---

## Step 3: Skill 2 — `/review-rollup`

### Location
`.claude/commands/review-rollup.md`

### Behavior
1. Read all assessment JSONs from `reports/assessments/*.json`
2. Compute aggregate metrics:
   - Average scores per category
   - Total issues by severity
   - Most common issue categories
   - Routes with lowest scores (problem areas)
   - Routes with highest scores (exemplars)
3. Compare with previous rollup (if exists in Notion) for trend analysis
4. Generate the Design Suggestions report
5. Create a Notion page in the Review Reports database with:
   - Summary scores table
   - Issue breakdown by severity and category
   - Per-route score table (sorted worst → best)
   - Top 5 critical/high issues with specific fix recommendations
   - Trend comparison (improving/degrading areas)
   - Links to all per-page assessment sub-pages
6. Clean up local `reports/assessments/` files

### Notion Page Structure
```
Design Review — 2026-03-04
├── Summary (scores, issue counts)
├── Critical Issues (table)
├── Per-Route Scores (table, sorted)
├── Trends (vs previous review)
├── Recommendations (prioritized action items)
└── Individual Assessments (linked sub-pages)
    ├── login — Assessment
    ├── register — Assessment
    ├── browse — Assessment
    └── ... (one per route)
```

---

## Step 4: Notion Integration

### New Database: "Design Reviews"
Create under Authentic Materials parent, separate from "Review Reports" (which tracks test runs):

```sql
CREATE TABLE (
  "Review"              TITLE,
  "Review Date"         DATE,
  "Routes Assessed"     NUMBER,
  "Avg Design Score"    NUMBER,
  "Avg A11y Score"      NUMBER,
  "Avg Overall Score"   NUMBER,
  "Critical Issues"     NUMBER,
  "High Issues"         NUMBER,
  "Medium Issues"       NUMBER,
  "Low Issues"          NUMBER,
  "Status"              SELECT('complete':green, 'in-progress':yellow, 'failed':red)
)
```

Per-page assessments are child pages of the review page (not database entries) — keeps them grouped and easy to navigate.

### Integration with Existing "Review Reports" DB
The `/review-rollup` skill should cross-link: include the latest Review Report URL in the design review page for traceability.

---

## Step 5: Wire Into `run-tests.ts`

After the existing Notion upload block, add:

```typescript
// ── Design review (automated) ───────────────────────────────────────────────
if (mode === 'visual' || mode === 'both') {
  // Skills are invoked manually via /review-screenshot and /review-rollup
  // Log reminder to user
  log(`\n${c.cyan}Screenshots captured for ${screenshotCount} routes.${c.reset}`);
  log(`${c.dim}Run /review-screenshot then /review-rollup for AI design review.${c.reset}`);
}
```

The skills are manual (invoked via slash commands in Claude Code) rather than automated in the test pipeline, because each screenshot review takes ~30s and a full 32-route review would take ~15 minutes.

---

## Step 6: Retire `design-review/agent.ts`

Once the new pipeline is verified:
1. Remove the design review prompt from `run-tests.ts` (lines 117-130)
2. Keep `design-review/` directory but mark `agent.ts` as deprecated
3. Remove `DESIGN_SUGGESTIONS.md` from the workflow (replaced by Notion)

---

## Files Changed/Created

| File | Action | Description |
|------|--------|-------------|
| `scripts/tests/routes.ts` | CREATE | Route registry (single source of truth) |
| `scripts/tests/auth.setup.ts` | CREATE | Playwright auth fixture |
| `scripts/tests/visual.spec.ts` | REWRITE | Use route registry, all 32 routes |
| `scripts/tests/smoke.spec.ts` | MODIFY | Use route registry for consistency |
| `scripts/playwright.config.ts` | MODIFY | Add setup projects for auth |
| `.claude/commands/review-screenshot.md` | CREATE | Skill 1: per-page visual assessment |
| `.claude/commands/review-rollup.md` | CREATE | Skill 2: aggregate + Notion report |
| `scripts/run-tests.ts` | MODIFY | Remove old design review prompt, add skill reminder |
| `scripts/upload-report.ts` | MODIFY | Cross-link design review in test reports |
| Notion (remote) | CREATE | "Design Reviews" database |

---

## Environment Variables Needed

```bash
# Already exist:
PLAYWRIGHT_BASE_URL=https://d1bwev65w7rqzl.cloudfront.net
PLAYWRIGHT_TEST_EMAIL=...
PLAYWRIGHT_TEST_PASSWORD=...
NOTION_API_KEY=ntn_...

# New:
PLAYWRIGHT_ADMIN_EMAIL=...       # Admin user for admin route screenshots
PLAYWRIGHT_ADMIN_PASSWORD=...
```

---

## Verification Checklist

1. `cd scripts && npm test` — all 32 routes produce screenshots + axe reports
2. `/review-screenshot` — processes all screenshots, creates Notion sub-pages
3. `/review-rollup` — creates summary page with linked assessments
4. Add a new route to App.tsx → add to `routes.ts` → next test run captures it automatically
5. Notion database shows historical reviews with trend data after 2+ runs

---

## Estimated Scope
- Route registry + auth fixtures: ~100 lines
- Expanded visual.spec.ts: ~80 lines (rewrite)
- Skill 1 (review-screenshot): ~40 lines (skill prompt) + supporting script if needed
- Skill 2 (review-rollup): ~40 lines (skill prompt) + supporting script if needed
- Integration changes: ~30 lines across run-tests.ts and upload-report.ts
- **Total: ~300 lines of new/modified code**

---

## Key Decisions

1. **Why not Chrome extension?** — Can't be automated. Playwright gives us real browser screenshots that Claude can analyze with vision, and new routes are captured automatically when added to the registry.
2. **Why one screenshot per Claude call?** — Each image + design system context is ~100K tokens. Batching would exceed context limits and produce lower-quality assessments.
3. **Why Notion sub-pages (not database rows)?** — Assessments are rich text with varied structure. Sub-pages keep them grouped under their review session and support full Notion formatting.
4. **Why manual skill invocation?** — A full 32-route review takes ~15 min. It should be intentional, not blocking every test run.
