# AuctionX — Master Lessons Learned

**Mandatory review before every module. Last updated: 2026-03-04**

---

## How to Use This Document

- **Read relevant sections BEFORE starting a module** (see MODULE_WORKFLOW.md Step 2.5)
- After completing a module, append new lessons to the appropriate section
- Per-module session history is archived in `docs/LESSONS_LEARNED.md` (historical reference only)
- Gotchas quick-reference table at the end (Section 10)

---

## 1. Schema & Database Rules

### Locked Schemas — Never Break Compatibility
- **Never** remove, rename, or retype existing fields (see `SCHEMA_LOCK.md`)
- **Never** make optional fields required
- Safe changes: add optional fields, append new enum values
- All schema changes require migration files in `supabase/migrations/`

### Enum Drift: Zod vs SQL
- Locked Zod schemas (`functions/src/v1/schemas/domain/`) have **DIVERGED** from SQL
- `AuctionStatus`: Zod says `RUNNING` / `CLOSED` / `VOIDED` — SQL says `ACTIVE` / `ENDED` / `CANCELLED` / `SETTLED`
- `ListingStatus`: Zod says `SUSPENDED` / `ARCHIVED` — SQL says `PENDING_REVIEW` / `SOLD` / `CANCELLED` / `REMOVED`
- `PaymentProcessor`: Zod says `SEGPAY` only — SQL has 5-processor cascade
- **Always verify enum values against `database.types.ts`**, never the Zod schemas

### Migration Idempotency Pattern
```sql
-- Enum creation (idempotent)
DO $$ BEGIN
  CREATE TYPE my_enum AS ENUM ('A', 'B');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Enum value addition (idempotent)
DO $$ BEGIN ALTER TYPE my_enum ADD VALUE IF NOT EXISTS 'C'; EXCEPTION WHEN others THEN NULL; END $$;
```

### Migration Rules
- `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` for all DDL
- `CREATE OR REPLACE FUNCTION` for functions (already idempotent)
- Triggers: wrap in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$`
- Policies: `DROP POLICY IF EXISTS` before `CREATE POLICY`
- **Never** add enum values AND reference them in the same migration transaction
- RLS + new enum values: cast to `::text` in the same transaction to avoid `55P04`
- `ALTER TYPE ... ADD VALUE` is non-transactional — can't be rolled back

### Type Assertions for Pre-Migration Tables
- New tables/columns not in `database.types.ts` require `as never` or `as any` casts
- **Always** add a `// TODO: Remove after db push + type regen` comment
- After migration: regenerate types, then grep and remove all temporary casts

### Type Regeneration Command (BOTH targets)
```bash
npx supabase gen types typescript --project-id pmlofthmobglcfkqjtru > frontend/src/types/database.types.ts
cp frontend/src/types/database.types.ts backend/src/types/database.types.ts
```

### Other Database Rules
- `SECURITY DEFINER` on triggers that modify other users' tables
- Add tables to Supabase Realtime publication explicitly (`ALTER PUBLICATION supabase_realtime ADD TABLE ...`)
- Service client bypasses RLS — **always filter by `user_id` manually** when using service role
- `Supabase { count: 'exact', head: true }` for count-only queries (no rows fetched)
- Supabase joins return arrays even for 1:1 relationships — access as `?.[0]`, not `.relation`

---

## 2. Express 5 & Backend Patterns

### Route Registration Order
- **Static routes MUST precede parameterized routes** — `/:id` catches everything
- Example: `/preferences` and `/mark-all-read` must come before `/:id/read`
- Same rule applies in React Router: `/verify/create/:id` before `/verify/:tokenName`

### Type Casting for Route Handlers
- `req.params` is `string | string[]` in Express 5 — always cast with `as string`
- Custom request types (extending `RequestWithId`) require `as unknown as RequestHandler`
- `as RequestHandler` alone is insufficient when the property mismatch is too large
- `router.use(requireAuth as any)` is acceptable for middleware with custom types

### Rate Limiting
- Apply via `router.use(limiter)` **before** all route handlers on the router
- Tiers: auth endpoints 10/min, write endpoints 30/min, read endpoints 60-120/min
- In-memory rate limit Maps are lost on restart — use persistent store (Redis/Supabase) for production
- **Every public read endpoint needs rate limiting** — add to your per-module checklist

### Health & Error Handling
- Health endpoint must be auth-free and mounted first in `server.ts`
- If mounted after auth middleware, health checks receive 401s → container restart loop
- Structured error handler: strip stack traces in production, include `requestId`
- `AppError` class with error codes for all backend errors

### API Patterns
- Response shape: `{ success, data, error }` — always
- Named exports only, no default exports
- Arrow function components
- User-scoped Supabase clients per request — never shared anon client for writes
- Admin routes inherit `verifyAdminAuth` + `adminRateLimit` from `routes/admin/index.ts` — don't re-apply

### Vitest vs Jest
- Auction mechanics tests use `vitest` imports — run `npx vitest run`, not `npx jest`
- `npx jest` fails with `import type` parse errors on these files

---

## 3. Supabase Edge Functions (Deno)

### Deployment
- External webhook receivers: deploy with `--no-verify-jwt`
- Internal functions (called from your own frontend/backend): keep JWT enabled
- Processor signature verification IS the security layer — not Supabase JWT

### Stripe in Deno
- **Use `constructEventAsync`**, NOT sync `constructEvent`
- Sync version uses Node's `crypto.timingSafeEqual` which silently fails in Deno
- Symptoms: correct webhook secret, correct body, but signature always fails
- Async version uses Web Crypto API (`crypto.subtle`) — native to Deno

### Environment & Imports
- `Deno.env.get('VAR')` with localhost fallback for dev: `Deno.env.get('FRONTEND_URL') || 'http://localhost:5173'`
- Edge functions are NOT checked by `npx tsc --noEmit` — use `deno check` locally
- Can't import Node modules — inline helpers when needed (e.g., 10-line `insertNotification()`)
- Shared code goes in `_shared/` directory

### Crash Safety
- Pre-create transaction record (PENDING status) before cascade — ensures DB record exists even if orchestrator crashes
- `crypto.randomUUID()` (Deno built-in) for pre-generating transaction UUIDs

### Scheduling
- Edge functions are NOT self-scheduling
- Use pg_cron + pg_net (within Supabase) or external cron (Vercel, Railway)
- Document the env var and call signature clearly for each cron target

---

## 4. Payment System Rules

### Content Flag Scoring
- Use **MAX individual score**, not sum — a single HIGH flag overrides any number of LOW flags
- `is_nsfw` from listing/category is the server-side floor — clients cannot downgrade
- `categories.default_content_flag` was planned but uses `is_nsfw` boolean as proxy currently

### Cascade Order
- LOW risk: Stripe → PaymentCloud → Signature → CCBill
- MEDIUM risk: PaymentCloud → Signature → CCBill
- HIGH risk: Signature → CCBill
- Cascade stops at first success — later processors never called

### Crypto (NOWPayments)
- **NEVER** in auto-cascade — user opt-in only
- `paymentMethod.type === 'CRYPTO'` exits early, never touches card cascade
- 72-hour payment window (vs 20 min for card)

### Stripe Specifics
- Metadata must be `Record<string, string>` — no arrays, objects, or non-string values
- `transactionId` MUST be in PaymentIntent metadata for webhook correlation
- Build an explicit `stripeMetadata` object: `{ transactionId, auctionId, listingId, sellerId }`
- Set ALL correlation fields before `orchestrator.processPayment()` — orchestrator passes metadata wholesale

### Business Rules
- Seller tiers: TIER_1 (0-$10K, 20%), TIER_2 ($10K-100K, 17.5%), TIER_3 ($100K+, 15%)
- Fee lookup defaults to TIER_1 (20%) on failure
- Card payment window: 20min | Crypto: 72hrs | Escrow hold: 72hrs
- CCBill = always final card fallback
- Max 2 relists per listing
- Transaction status enum: PENDING → PROCESSING → SUCCEEDED (not COMPLETED) → FAILED/REFUNDED/etc.

### Payment Attempts Logging
- Every cascade attempt (success or fail) logged to `payment_attempts`
- Fields: `transaction_id`, `processor`, `attempt_number`, `success`, `response_time_ms`, `raw_response`

---

## 5. Frontend & React Patterns

### Route Order
- Specific routes before parameterized: `/verify/create/:verificationId` before `/verify/:tokenName`
- Document route order dependencies with inline comments

### URL State & Search
- `useSearchParams` as single source of truth for filter/sort/page state
- Makes results page fully bookmarkable and shareable without sync logic
- Store URL params in cents (matching API) for price filters

### Type Collisions
- `Notification` type name collides with browser global — use aliased names like `NotificationsResponse`
- TypeScript may treat your import as unused if it conflicts with a global

### Price Handling
- Display: dollars | Store/send: cents | Convert at UI boundary
- `formatPrice()` from `lib/utils` — **never manually divide by 100**

### Supabase Queries
- Joins return arrays even for 1:1 — access as `listing.auctions?.[0]`
- Listing query pattern: `.select('id, title, auctions(id, current_price_cents, end_time, status), listing_media(url, type, sort_order)')`
- `verifiedOnly` requires `!inner` join in select string, not `.not('...', 'is', null)`
- `{ count: 'exact', head: true }` for count-only stat queries

### Component Patterns
- `data-testid` pattern: `{noun}-{role}` — containers get `-grid`, items get `-card`, actions get `-button`
- Add `data-testid` at component creation time, not retroactively
- `NavLink end` prop on index routes — prevents active state bleeding to all sub-routes
- Debounce with `useRef<ReturnType<typeof setTimeout>>` — avoids stale closures

### Design System (Dark Mode Only)
- Backgrounds: `dark-800` (#13131a), `dark-700` (#1a1a24)
- Primary: Purple gradient (#7c3aed → #3b82f6)
- Cards: Glassmorphism (`backdrop-blur` + border), use `glass` utility class
- Rounded corners: `rounded-2xl` for cards, `rounded-xl` for buttons
- WCAG 2.2 AA: 4.5:1 contrast minimum, visible focus indicators, keyboard nav

### State Management
- Zustand for client state
- User-scoped Supabase clients for writes — never shared anon client
- Supabase Realtime for live updates (notifications, messages, auctions)

---

## 6. Security Checklist (Per-Module)

Run through this checklist for every module before committing:

- [ ] Is every **public read** endpoint rate-limited?
- [ ] Is every **write** endpoint behind `requireAuth`?
- [ ] Are **webhook** endpoints using processor signature verification (not just JWT)?
- [ ] Does the module add **admin routes**? → Verify `adminAuth` middleware inheritance
- [ ] Does the module accept **user input**? → Zod validation required
- [ ] Does the module handle **content flags**? → Server-side lookup, never trust client
- [ ] Are **secrets** in env vars only? (never hardcoded, never committed)
- [ ] Does the module add a **new table**? → Verify RLS policies are enabled
- [ ] Does the module use **service client**? → Manual `user_id` filtering required
- [ ] Are there new **Express routes**? → Static routes registered before `/:id` parameterized routes

### Security Patterns
- 3-layer admin auth: JWT + `admin_users` table + `session_version`
- All admin actions logged to `audit_logs` table
- Message filtering: 10 regex patterns blocking phone, email, social media, URLs
- CORS restricted to `FRONTEND_URL` env var — if unset, no CORS headers emitted (restrictive default)
- `.env` files in `.gitignore` — never commit secrets
- `express.json({ limit: '10kb' })` recommended for body size cap

---

## 7. Migration & Deployment Patterns

### Pending Migrations (must push before prod)
1. `20260301000001_auction_settlement.sql`
2. `20260301000002_payouts_table.sql`
3. `20260301100000_nfc_verification.sql`
4. `20260302000001_full_text_search.sql`
5. `20260302120000_messaging.sql`
6. `20260303000001_notifications.sql`
7. `20260303000002_content_flag_enum_expansion.sql`

### Deploy Sequence
1. Apply DB migrations (`npx supabase db push`)
2. Regenerate types (both frontend + backend)
3. Remove `as never` / `as any` migration-pending casts → `npx tsc --noEmit`
4. Deploy Supabase edge functions (all 5, with env vars set)
5. Deploy backend to Railway → verify `/api/v1/health` returns 200
6. Deploy frontend to Vercel → confirm `vercel.json` rewrites active
7. Configure Stripe webhook in dashboard → point to edge function URL
8. Smoke test end-to-end: register → list → bid → settle → pay → release

### Edge Function Deploy
```bash
supabase functions deploy process-payment --project-ref pmlofthmobglcfkqjtru
supabase functions deploy payment-webhook --project-ref pmlofthmobglcfkqjtru --no-verify-jwt
```
- `--no-verify-jwt` for webhook receivers only

### Env Vars That Must Match Between Services
| Variable | Backend | Edge Functions |
|----------|---------|----------------|
| `SETTLE_SECRET` | Yes | `settle-auction` |
| `RELEASE_ESCROW_SECRET` | Yes | `release-escrow` |
| `FRONTEND_URL` | Yes | All 4 edge functions |

### Deployment Configs as Code
- `vercel.json`: SPA rewrite + security headers
- `railway.json`: health check path + restart policy
- `backend/Procfile`: Railway process entry point
- Commit these alongside code — prevents "works locally, broken in prod"

---

## 8. Testing & Verification

### Before Every Commit
```bash
cd frontend && npx tsc --noEmit   # Frontend type check
cd backend && npx tsc --noEmit    # Backend type check
cd frontend && npm run build      # Production build check
```

### Test Commands
- Mechanics tests: `cd backend && npx vitest run` (NOT `npx jest`)
- API integration tests: fastest ROI — 401 contract tests verify protected routes
- E2E tests: `test.skip()` for env-dependent tests, not hard failures
- Playwright `webServer.url` must be a truly public endpoint (not behind auth)

### Testing Tips
- API integration tests need no auth tokens for 401 contract verification
- Dead nav links accumulate without tests — smoke test every nav link
- `data-testid` attributes should be added at component creation time

---

## 9. Documentation Requirements

From `DOCUMENTATION_STANDARD.md` — commit should NOT happen until all artifacts are complete:

0. `docs/MASTER_LESSONS_LEARNED.md` reviewed before starting (mandatory)
1. `docs/MODULE_{XX}_VERIFICATION.md` exists and is filled out
2. All new files have top-of-file doc comments
3. All exported functions have JSDoc
4. `docs/TODO.md` updated (even if "No new TODOs")
5. `docs/MASTER_LESSONS_LEARNED.md` updated with any new cross-cutting lessons or gotchas

---

## 10. Common Gotchas Quick Reference

| # | Gotcha | Wrong | Right | Source |
|---|--------|-------|-------|--------|
| 1 | Auction status in SQL | `RUNNING` | `ACTIVE` | Schema drift (Module 14) |
| 2 | Transaction status | `COMPLETED` | `SUCCEEDED` | Module 09 |
| 3 | Stripe metadata types | `Record<string, unknown>` | `Record<string, string>` | HIGH Priority Fixes |
| 4 | Express route order | `/:id` before `/static` | `/static` before `/:id` | Module 16 |
| 5 | React Router route order | `/verify/:token` before `/verify/create/:id` | `/verify/create/:id` first | Module 13 |
| 6 | Stripe webhook in Deno | `constructEvent()` (sync) | `constructEventAsync()` | Module 09 |
| 7 | Edge fn webhook deploy | `supabase functions deploy` | `... deploy --no-verify-jwt` | Module 09 |
| 8 | Supabase 1:1 join access | `listing.auction` | `listing.auctions?.[0]` | Module 06 |
| 9 | Content flag scoring | Sum of all scores | MAX individual score | Module 09 |
| 10 | NOWPayments in cascade | Auto-cascade | User opt-in only | Module 09 |
| 11 | Price display vs storage | Both dollars | Display dollars, store cents | Module 14 |
| 12 | Service client + RLS | Trust RLS to filter | Manual `.eq('user_id', id)` | Module 14 |
| 13 | `as RequestHandler` cast | Single cast | `as unknown as RequestHandler` | Module 14 |
| 14 | Vitest in Jest project | `npx jest` | `npx vitest run` | Module 02 Port |
| 15 | `Notification` type name | Import `Notification` | Use `NotificationsResponse` | Module 16 |
| 16 | `NavLink` on index route | No `end` prop | `<NavLink end>` | Module 10 |
| 17 | Admin suspend body | `{ reason }` only | `{ reason, durationHours }` | Module 10 |
| 18 | Admin moderation resolve | `{ action, reason }` | `{ action, notes }` | Module 10 |
| 19 | `categories.default_content_flag` | Assume column exists | Use `is_nsfw` boolean proxy | Module 09 |
| 20 | `search_vector` pre-migration | Direct `.textSearch()` | `as never` + TODO comment | Module 14 |
| 21 | Web NFC types | `npm install wicg-web-nfc` | `(window as any).NDEFReader` | Module 13 |
| 22 | Edge fn tsc check | `npx tsc --noEmit` | `deno check` | Module 09 |
| 23 | Sitemap in Vercel build | Run during build | Post-deploy CI step / cron | Module 18 |
| 24 | `window.onerror` return | `return true` (silences) | `return false` (keeps default) | Module 18 |
| 25 | Health route placement | After auth middleware | Before all middleware | Module 18 |
| 26 | `verifiedOnly` filter | `.not('...', 'is', null)` | `!inner` join in select string | Module 14 |
| 27 | Enum + RLS same txn | `IN ('NEW_VALUE')` | `::text IN ('NEW_VALUE')` | Module 13 |
| 28 | auth.users manual insert | INSERT via SQL console | Dashboard → Auth → Users | Session B |
| 29 | user_role enum casing | `ADMIN`, `SUPER_ADMIN` | `admin`, `super_admin` | Session B |
| 30 | auth.users ON CONFLICT | `ON CONFLICT (email)` | Existence check before insert | Session B |
| 31 | `constructEventAsync` await | `event = constructEventAsync(...)` | `event = await constructEventAsync(...)` | Session E |

---

## Appendix: Source Documents

This document consolidates lessons from:
- `docs/LESSONS_LEARNED.md` — Per-module implementation lessons
- `docs/SECURITY_AUDIT.md` — Security findings and remediation
- `docs/SCHEMA_LOCK.md` — Frozen schema rules
- `docs/CONTENT_FLAG_GUIDELINES.md` — Payment routing rules
- `docs/DOCUMENTATION_STANDARD.md` — Documentation requirements
- `docs/LAUNCH_CHECKLIST.md` — Deployment lessons
- `docs/PAYMENT_DEPLOY_CHECKLIST.md` — Payment deployment lessons
- `docs/TODO.md` — Patterns from deferred work
- `docs/MODULE_WORKFLOW.md` — Common pitfalls
- `CLAUDE.md` — Project rules and known issues
- Inline source code TODOs/NOTEs/WARNINGs
- Session memory (MEMORY.md)
