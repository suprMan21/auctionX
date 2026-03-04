# AuctionX — Lessons Learned

---

## HIGH Priority Fixes — 2026-03-03

### What Worked

- **Stripe metadata must be `Record<string, string>`**: Passing `Record<string, unknown>` to `paymentIntents.create()` silently includes array values (e.g. `contentFlags`) that Stripe rejects. Build an explicit `stripeMetadata` object with only string fields (`transactionId`, `auctionId`, `listingId`, `sellerId`). This also ensures webhook correlation works: `paymentIntent.metadata.transactionId` matches our internal UUID.
- **Rate-limiting public endpoints with `router.use(limiter)`**: Applying `rateLimit` via `router.use()` before all route handlers is cleaner than per-route application — one line covers all methods and paths on that router. Use conservative limits on public, unauthenticated endpoints (60/min for search, 120/min for verify pages, 30/min for NFC scans).
- **Dispute resolution reuses existing columns**: The settlements table doesn't have dedicated `dispute_resolution_notes` columns. Writing the admin resolution decision into `dispute_reason` (prefixed with `APPROVED:` / `REJECTED:`) is a clean interim approach — the audit_log middleware provides the full trail, and a future migration can add proper columns.
- **FRONTEND_URL was already fixed**: All four edge functions already had `Deno.env.get('FRONTEND_URL') || 'http://localhost:5173'`. Verifying pre-existing state before implementing is always faster than re-implementing.
- **`ALTER TYPE ... ADD VALUE IF NOT EXISTS` is safe for enum expansion**: Postgres enum additions are non-transactional (can't be rolled back in the same txn), but `IF NOT EXISTS` makes them idempotent. Use `TEXT DEFAULT NULL` for per-category flags until the enum is stable.

### What To Watch Out For

- **Upstream metadata must include all fields before the orchestrator runs**: `auctionId` was available in `process-payment/index.ts` (fetched in step 4) but never added to `paymentRequest.metadata`. The orchestrator passes metadata wholesale to processors — if a field isn't set before `orchestrator.processPayment()`, it will be missing in all processors. Set all correlation fields together after server-side validation completes.
- **Admin routes inherit middleware from the index router**: `/api/v1/admin/*` already applies `verifyAdminAuth` + `adminRateLimit` via `router.use()` in `routes/admin/index.ts`. Individual admin route files don't need to re-apply auth. Adding `requirePermission()` per-route is fine for additional granularity.
- **Vitest tests in a Jest project**: The mechanics test suite uses `vitest` imports but lives in a backend configured with Jest. Running `npx jest` fails with `import type` parse error. Always run `npx vitest run` for these tests.

---

## Module 18: Launch Prep — 2026-03-03

### What Worked

- **Extracting the error handler before launch is high value**: The inline anonymous error handler in `server.ts` had no structured logging, no requestId propagation, and leaked stack traces in all environments. Pulling it into `errorHandler.ts` added all three in ~25 lines. Any project with an Express backend should extract this in the first sprint, not the last.
- **Deployment configs as code**: `vercel.json` and `railway.json` commit security headers and health check paths alongside the code. This prevents the "works locally, broken in prod" class of deployment issues where security headers were configured in a dashboard and forgotten.
- **Error tracking stub pattern**: Shipping `initErrorTracking()` as a console stub with commented-out Sentry calls is the right approach for pre-launch. Real Sentry activation is a one-line uncomment once the DSN is available — no API changes required.
- **`robots.txt` disallows list is as important as the allow list**: Explicitly disallowing `/admin`, `/settings`, `/messages`, `/payouts`, `/settlements` prevents crawlers from accidentally indexing authenticated pages and surfacing them in search results.

### What To Watch Out For

- **`og-image.png` is always forgotten until someone shares the link**: The meta tag is trivial to write, but the actual image asset is out-of-scope for a developer sprint. Add it to the launch checklist and designer handoff early — not as the last step.
- **Health check route must be auth-free and mounted first**: `/api/v1/health` is mounted before all other routes in `server.ts`. If it were mounted after auth middleware, Railway's health check would receive 401s and restart the container in a loop. Always ensure health check paths bypass all middleware except request-ID.
- **`window.onerror` returning `false` is intentional**: Returning `false` from `window.onerror` tells the browser not to suppress the default error handling. Returning `true` would silence the error in the console — undesirable during development. The stub correctly returns `false`.
- **Sitemap generation requires build-time credentials**: `scripts/generateSitemap.ts` can't run in a pure frontend Vercel build because it needs Supabase credentials. Wire it as a separate CI step (post-deploy) or use a Vercel cron function that runs after deployment, not during the build.

---

## Module 17: E2E Testing & Security Audit — 2026-03-03

### What Worked

- **`data-testid` retrofitting is mechanical but necessary**: Adding testids to existing components required reading each file once, then making a single-attribute edit. The pattern is `data-testid="{noun}-{role}"` — container grids get `{noun}-grid`, individual items get `{noun}-card`, action elements get `{action}-button`. Future modules should add these at component creation time.
- **Graceful `test.skip()` for environment-dependent tests**: E2E tests that need real Supabase users call `test.skip()` when test data is absent. This prevents hard CI failures on infra without seeded users while still documenting what needs to be covered when the environment is ready.
- **API integration tests are the fastest return on investment**: 10 tests, ~200ms, no auth tokens needed for the 401 contract tests. These verify the most critical security property (protected routes return 401) and should run in every CI pipeline from day one.
- **Security audit as living document**: Writing the audit as a Markdown table (PASS/FAIL/NEEDS_WORK) with remediation priority makes findings actionable. Cross-linking to TODO.md ensures issues don't get lost.

### What To Watch Out For

- **Dead nav links accumulate without tests**: Header.tsx had `/dashboard` and `/create-listing` broken for multiple modules. TypeScript can't catch incorrect route strings. A smoke test that visits every nav link is cheap insurance.
- **Playwright `webServer.url` must be a truly public endpoint**: The backend webServer poll URL must return a non-error status without auth. Using a protected endpoint causes Playwright to hang waiting for readiness.
- **In-memory rate limit state resets on restart**: The admin rate limiter Map is lost when Node.js restarts. In a crash-restart loop (common under load), an attacker gets unlimited attempts. Always back rate limit state with a persistent store (Redis, Supabase) for production.
- **Missing rate limits on public read endpoints**: Auth protects writes, but public reads (search, browse) need their own rate limits. Add a checklist item: "Is this public read endpoint rate-limited?" when creating new routes.

---

## Module 16: Notifications System — 2026-03-03

### What Worked

- **Non-fatal notification pattern**: Wrapping all notification calls in try/catch (or `.catch(() => {})`) and never letting them throw is the correct pattern. Notification failures should never affect primary flows (bidding, payment, messaging). This was implemented consistently across both Express controllers and Deno edge functions.
- **Preference checking before insert**: Fetching the `notification_preferences` row before inserting a notification prevents unnecessary DB writes and gives users meaningful control. Upserting defaults on first access (instead of requiring users to explicitly configure preferences) provides a great out-of-the-box experience.
- **`Promise.allSettled` for batching**: Using `sendBatch()` with `Promise.allSettled()` ensures one failed notification doesn't prevent others from being sent — the right primitive for parallel notification delivery.
- **Inline helper for Deno**: Since edge functions (Deno) can't import Node.js modules, inlining a 10-line `insertNotification()` helper in each function file is the right approach. The pattern is minimal, readable, and eliminates the need for a shared Deno notification module.
- **Static routes before `:id` routes**: In the notifications router, `/preferences` and `/mark-all-read` must be registered before `/:id/read`. This prevents Express from interpreting "preferences" or "mark-all-read" as an `:id` parameter.

### What To Watch Out For

- **`Notification` type name collision**: The browser's global `Notification` interface conflicts with an imported `Notification` type. TypeScript treats the import as unused when only `NotificationsResponse` and `NotificationPreferences` are referenced in `api.ts`. Always check what global names conflict with custom domain types.
- **Service client in notification service**: The `notificationService` must always receive a service-role client — it needs to write notifications for any user regardless of the caller's auth context. Passing a user-scoped client would fail with RLS violations.
- **Email address lookup**: The notification service fetches the user's email from `users.email` to send transactional emails. This assumes the `users` table has an `email` column populated at signup. Verify this column is synced from `auth.users` via trigger before enabling real email delivery.
- **FRONTEND_URL env var in edge functions**: `Deno.env.get('FRONTEND_URL')` must be set in both `supabase/.env.local` (local dev) and Supabase dashboard secrets (production). Without it, notification `action_url` fields point to `localhost:5173` in production.

---

## Module 14: Enhanced Search — 2026-03-02

### What Worked

- Replacing direct Supabase ilike queries with a backend search endpoint is the right architecture: it centralises auth, pagination logic, and makes the search surface testable via curl without needing a browser.
- Using `useSearchParams` (react-router-dom) as the single source of truth for all filter/sort/page state makes the results page fully bookmarkable and shareable without any extra sync logic.
- The `verifiedOnly` dynamic inner-join trick (switching `item_verifications(...)` to `item_verifications!inner(...)` in the select string) is clean and avoids a second query or client-side filter.

### Patterns Discovered

- **SQL enum values diverge from locked Zod schemas — always verify against `database.types.ts`**: The locked Zod schemas (`functions/src/v1/schemas/domain/`) use `RUNNING` for auction status, but the SQL database uses `ACTIVE`. A query using `RUNNING` would silently return zero results. Always check `database.types.ts` (generated from the real DB) not the locked Zod schemas for enum values.

- **`verifiedOnly` requires a dynamic inner join in the select string, not just a `.eq()` filter**: PostgREST outer joins return all parent rows with null for the joined table when there is no match. To filter to only rows _with_ a match, the join must be `!inner` in the select string. A `.not('item_verifications', 'is', null)` filter alone is insufficient because the join is already resolved as outer before the filter runs.

- **Service client bypasses RLS — always filter by `user_id` manually on saved_searches**: The Supabase service role key ignores all Row Level Security policies. The `getSavedSearches` handler must include `.eq('user_id', userId)` even though RLS would normally enforce this for an anon/user client.

- **`search_vector` column not in generated types until migration is applied**: `.textSearch('search_vector', ...)` requires the column to exist in `database.types.ts`. Before migration is pushed and types are regenerated, use `as never` type assertion. Add a comment and TODO entry so this is removed after the push.

- **Price filter inputs display in dollars, store/send in cents**: The filter sidebar shows dollar amounts to users (`$25`) but the API expects cents (`2500`). The conversion (`value * 100` / `value / 100`) must happen at the UI boundary. Storing in URL params as cents (matching the API) keeps the conversion predictable.

### Gotchas

- **Unused import causes TS error in strict mode**: `Link` was imported in `SearchResultsPage.tsx` from react-router-dom but not used. TypeScript strict mode (noUnusedLocals) rejects this. Clean imports on every file before running `tsc --noEmit`.
- **`as RequestHandler` not enough for custom `RequestWithId` types**: The SearchRequest interface extends `Request + RequestWithId`. The single `as RequestHandler` cast fails because the property mismatch is too large; `as unknown as RequestHandler` is required. This is the established project pattern (see verifications.ts).

---

## Module 02 Port: Auction Mechanics → Backend — 2026-03-01

### What Worked

- The `functions/src/v1/services/auctions/` files were genuinely Firebase-free — zero `firebase-admin`
  imports in any of the five mechanics files. Pre-verification before starting saved time.
- Flattening the import names (e.g., `auction.errors.ts` → `errors.ts`) makes the internal module
  cleaner without losing any information, since the directory name `auction/` already provides context.
- Inline port interfaces (`ListingsRepoPort`, `AuctionsMetaRepoPort`) in `closeOrchestrator.ts` are
  preferable to re-exporting Firestore-coupled types. Any future Supabase adapter just needs to satisfy
  the minimal shape.

### Patterns Discovered

- **Port interfaces over concrete types for repo dependencies**: Instead of importing the real repo class,
  define a minimal interface with only the methods actually called. This decouples the orchestrator from
  the storage layer entirely and makes it trivially testable with inline mock objects.
- **Barrel + named exports only**: The `index.ts` barrel with explicit named exports is the right pattern
  for a multi-file library module — consumers get tree-shaking, and the public surface is immediately
  visible without reading every file.
- **Zod version alignment**: When porting Zod-dependent code, use the same major version (`^3.x`) to
  avoid subtle schema behavior differences between major versions.

### Gotchas

- **`grep -rn "from.*repos"` matches JSDoc comments**: The verification grep `grep -rn "from.*repos"`
  matched a JSDoc line (`* Load auction core + listing + auction meta from repos`) — not an import.
  The check still passes; be aware when writing grep-based verification rules that comments can
  produce false positives. Use `grep -rn "^import.*repos"` for stricter import-only checking.
- **`nextSecondMax` type mismatch**: In `mechanics.ts` the challenger branch uses `let nextSecondMax: number | null`
  (not `MoneyCents | null`) to allow `Math.max()` without a cast. This matches the source exactly
  and TypeScript accepts it — the final `repriceProxyState` call handles the narrowing.

### Time Estimate vs Actual

- Estimated: ~30 minutes
- Actual: ~15 minutes
- Delta: Source files were clean; no unexpected Firebase dependencies discovered

---

## Module 12: Seller Payouts — 2026-03-01

### What Worked

- Mirroring the `settle-auction` shared-secret auth pattern for `release-escrow` is clean and consistent — new edge functions should follow this same pattern.
- Keeping `calculatePayout()` as a pure function in `_shared/payment/payoutCalculation.ts` makes it independently testable without Supabase or Deno context.
- Using the `moderation_queue` table for dispute tracking (rather than a new table) reuses existing admin tooling at zero schema cost.

### Patterns Discovered

- **Typed Supabase client `from()` fails for new tables until migration + type regen**: The generated `database.types.ts` only reflects the DB state at the time of last `supabase gen types` run. Any new table added via migration will cause TS errors on `supabase.from('new_table')`. Solution: cast `supabase as any` with a TODO comment, apply migration, regen types, then remove the cast.
- **Express `req.params` destructuring can produce `string | string[]`**: When typing custom request interfaces that extend multiple middleware types, destructuring `const { id } = req.params` can lose the `string` narrowing. Use `req.params['id'] as string` when this occurs.
- **`settlement.status` type union must be updated in parallel with DB**: New status values (`RELEASED`, `DISPUTED`) introduced by Module 12 must be added to both the SQL `CHECK` constraint (implicitly via direct update in the edge function) and the TypeScript `SettlementStatus` union. The two can diverge if only one is updated.
- **Cron functions need external orchestration**: Supabase edge functions are not self-scheduling. To call `release-escrow` every 5 minutes, use pg_cron + pg_net (within Supabase) or an external cron (Vercel, Railway). Document the env var and call signature clearly.

### Gotchas

- **Spec had `t.status = 'COMPLETED'` — wrong**: The `transactions` table uses `SUCCEEDED`, not `COMPLETED`, for successful payments. Always verify against the DB enum, not the spec text.
- **Spec PayoutsPage join path was wrong**: `settlements(listing_id, listings(title))` — but `settlements` has no `listing_id`. Correct path: `settlements(auction_id, auctions(listing_id, listings(title)))`.
- **`escrow_ends_at` was missing**: `payment-webhook` set status to `ESCROW_HOLD` but never set `escrow_ends_at`. Without it, `release-escrow` could never find any releasable settlements. Always check that new fields required by downstream functions are actually set by upstream code.
- **Express `Array.isArray()` narrowing**: TypeScript may not narrow `string | string[]` via `Array.isArray()` when the branch result type is re-unified — use `as string` cast in the false branch or after the ternary when the value is known to be scalar.

---

## Module 10: Admin Dashboard Frontend — 2026-03-01

### What Worked

- Splitting the route guard into two stages (session check → `admin_users` query) gives clean separation: unauthenticated users go to `/login`, authenticated non-admins go to `/`. The single `<Outlet />` pattern means the guard is fully transparent to children.
- React Router's `<NavLink end>` prop on the `/admin` index route correctly avoids the active state bleeding into all `/admin/*` sub-routes.
- Using `Promise.all` in AdminDashboardPage to fetch users, moderation queue, Supabase direct counts, and audit logs in parallel keeps the dashboard fast even with 5 concurrent requests.
- The `adminFetch` wrapper pattern (mirrors `lib/api.ts`) keeps all auth header injection in one place. Non-2xx responses reliably extract the `error` field from the backend's JSON response shape.

### Patterns Discovered

- **Health endpoint defensiveness**: The spec mentioned building the health page with graceful 404 handling — and indeed the `/admin/health` endpoint doesn't exist in the backend at module completion time. Any feature that depends on an optional or future endpoint should catch errors and show a helpful warning rather than a blank/broken state.
- **`NavLink end` for index routes**: Without the `end` prop, `/admin` will match as active for every route under `/admin/*` since it's a prefix. Always add `end` to the exact-path NavLink for the index route.
- **Supabase `count: 'exact', head: true` for count-only queries**: Fetching only the count (no rows) is much faster than fetching all rows and checking `.length`. Use `{ count: 'exact', head: true }` for stat cards.
- **Debounce with `useRef` timer**: The 300ms search debounce uses a `useRef<ReturnType<typeof setTimeout>>` to hold the timer, cleared on each new keypress. Using a ref avoids stale closure issues and doesn't cause re-renders.

### Gotchas

- **Backend suspend endpoint requires `durationHours`**: The module spec description only showed `{ reason }` in the request body, but the actual backend route validates `!durationHours || !reason` — omitting `durationHours` returns a 400. Always read the actual backend route file, not just the spec description.
- **Moderation resolve uses `notes` not `reason`**: The backend destructures `{ action, notes }` from the request body. The spec said `{ action, reason }`. This would have caused 400 errors on every resolve action without reading the actual route.
- **Unsuspend is separate from unban**: `/users/:id/unsuspend` and `/users/:id/unban` are distinct routes. The AdminUserDetailPage action buttons must use the correct endpoint for each state transition.
- **`admin_users` RLS with anon client**: `AdminProtectedRoute` queries `admin_users` using the anon Supabase client. This relies on RLS permitting the user to read their own row. If RLS blocks it, the check silently fails and the user is treated as non-admin. A backend endpoint would be more reliable.

### Time Estimate vs Actual

- Estimated: ~60 minutes (Claude Code session)
- Actual: ~15 minutes
- Delta: Exhaustive backend route reading before writing any frontend code eliminated all spec-vs-implementation mismatches upfront

## Module 09: Payment Hardening — 2026-03-01

### What Worked

- The `_shared/` directory convention for Edge Functions worked perfectly — both `process-payment` and `payment-webhook` import from `../_shared/` without issues
- Pre-creating the transaction record (PENDING status) before the cascade is cleaner than creating it after: ensures a DB record exists even if the orchestrator crashes, and allows `payment_attempts` to reference `transaction_id` during the cascade
- Using `crypto.randomUUID()` (Deno built-in) to pre-generate the transaction UUID is simple and reliable

### Patterns Discovered

- **Always check DB enum values before writing**: `transaction_status` uses `SUCCEEDED` (not `COMPLETED`), and `PaymentStatus.COMPLETED` (internal enum) doesn't match. Always define a STATUS_MAP to translate between internal enums and DB values.
- **Deno Edge Functions are NOT checked by `npx tsc --noEmit`**: Frontend/backend TypeScript passes but Edge Functions use Deno. Use `deno check` locally to verify. The `_shared/` processor files had mismatched types (PaymentProcessor interface not exported from types.ts) that would only surface at Deno check time.
- **Flag scoring: max vs additive matters**: The original code used additive flag scores (SWIMWEAR=3 + LINGERIE=4 = 7 → HIGH). Business rules say use the highest individual score (max(3,4) = 4 → MEDIUM). The difference is meaningful for multi-flag listings.
- **is_nsfw as content-flag proxy**: Since `categories.default_content_flag` doesn't exist in the DB schema, `listing.is_nsfw` and `category.is_nsfw` serve as a binary floor. This is a temporary solution — proper per-category default flags should be added as a DB migration (see TODO.md).

### Gotchas

- **`categories.default_content_flag` is documented but doesn't exist**: CONTENT_FLAG_GUIDELINES.md and the module spec both reference this column, but it's absent from the schema. Plan around it rather than assuming it exists.
- **NOWPayments was in the auto-cascade**: `CascadeOrchestrator` had NOWPAYMENTS in all three risk-level cascade arrays, contradicting business rules (crypto is user opt-in, never auto-cascaded). Always re-verify implementation against business rules before shipping.
- **`handleWebhook` missing from StripeProcessor**: The `payment-webhook` handler calls `processor.handleWebhook(req)` but StripeProcessor had no such method — it would throw at runtime. BaseProcessor doesn't declare it abstract either. Added it to StripeProcessor with proper `stripe.webhooks.constructEvent` signature verification.
- **MEDIUM risk gap in DB enum**: SWIMWEAR, LINGERIE, PERSONAL_ITEM, FETISH appear in CONTENT_FLAG_GUIDELINES.md as MEDIUM-risk flags but don't exist in the `content_flag` DB enum. The DB currently only has LOW and HIGH flags — any listing with MEDIUM-intent items gets misclassified as LOW unless explicitly marked is_nsfw.
- **Stripe PaymentIntent metadata**: To correlate Stripe webhooks with our internal transaction UUIDs, `transactionId` must be passed in the Stripe PaymentIntent `metadata` field at creation time. Currently it isn't — webhook fallback uses Stripe's PaymentIntent ID, which won't match `transactions.id`. See TODO.md.

### Time Estimate vs Actual

- Estimated: ~30 minutes (Claude Code session)
- Actual: ~8 minutes
- Delta: Exploration phase caught schema mismatches before implementation, preventing rework

## Module 06: Browse & Search — 2026-03-01

### What Worked

- Supabase join query pattern for listings + auctions + media is clean and reusable
- Building ListingCard as a shared component paid off immediately (used in 2 pages)
- Basic ilike search is surprisingly functional for early-stage — good enough to ship
- `useSearchParams` from react-router-dom makes URL-synced search state trivial

### Patterns Discovered

- **Listing query pattern:** `.select('id, title, auctions(id, current_price_cents, end_time, status), listing_media(url, type, sort_order)')` — use this everywhere listings need price/image data
- **Price formatting:** Always use `formatPrice()` from `lib/utils/formatPrice.ts` — never manually divide by 100
- **Time display:** `timeRemaining()` for static display, `useCountdown` hook (Module 08) for live countdown
- **Public routes:** Browse and search don't need auth — bidding is gated at the auction detail level
- **Category slugs:** The `categories` table has a real `slug` column. Filter server-side with `.eq('slug', categorySlug)` — no client-side slug generation needed.

### Gotchas

- Supabase joins return arrays even for 1:1 relationships — always access as `listing.auctions?.[0]` not `listing.auction`
- The `.ilike()` filter is case-insensitive but doesn't handle partial word matching well ("jersey" won't match "New Jersey Nets jersey" if user types "net")
- `as never` cast required on `.order('sort_order')` for categories because sort_order is not in the generated TypeScript select type

### Time Estimate vs Actual

- Estimated: ~15 minutes (Claude Code session)
- Actual: 3m 30s
- Delta: Simpler than expected — no backend work needed, just frontend pages + Supabase queries

## Module 13: NFC Verification System — 2026-03-01

### TypeScript gotchas

- **Route handler type casting**: Express 5 + custom request types (extending `RequestWithId`) require `as unknown as RequestHandler` on route registration — same pattern as settlements/payouts routes. Should be the default when wiring custom-typed controllers.

- **`wicg-web-nfc` types**: Don't add the npm package — it inflates the build. Use `(window as any).NDEFReader` and `(event: any)` for NFC callbacks. The `/// <reference types="wicg-web-nfc" />` directive only works if the package is installed.

- **New Supabase tables before migration is pushed**: If `database.types.ts` doesn't include the new table yet, use `(supabase.from as any)('table_name')` with explicit result types. Remove the cast after `npx supabase db push` + type regeneration.

- **Dynamic vs static imports**: A dynamic `import()` inside a component that is also statically imported elsewhere causes Vite to emit a warning. Use a static import at the top of the file — the module is already in the bundle.

### Architecture decisions

- **Two Express routers from one file**: The authenticated `/verifications` router and the public `/verify` router are both exported from `routes/verifications.ts`. Cleaner than splitting into two files since the controllers are shared.

- **S3 presigned URLs from Express backend**: The plan called for generating presigned URLs in the Express backend (not a Deno edge function). This required adding `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` to backend dependencies. Works well.

- **Non-fatal ownership transfer in release-escrow**: The NFC transfer block is wrapped in a try/catch with a `logger.warn` on failure. Settlement release is the critical path — NFC state should never block a payout.

- **Route order in React Router**: `/verify/create/:verificationId` MUST be declared before `/verify/:tokenName` or "create" matches as a token name. Document this with a comment.

### PostgreSQL enum + migration idempotency (discovered during Module 13 push)

When a `db push` fails mid-migration, Supabase marks the migration as not yet applied but some statements may have already committed (Postgres DDL is not transactional for `CREATE TYPE`). Re-running then hits `42710 duplicate_object`.

**Pattern to use for all future migrations involving enums:**

```sql
-- 1. Create enum idempotently
DO $$ BEGIN
  CREATE TYPE my_enum AS ENUM ('A', 'B');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. Add each value idempotently (handles partial prior creation)
DO $$ BEGIN ALTER TYPE my_enum ADD VALUE IF NOT EXISTS 'A'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE my_enum ADD VALUE IF NOT EXISTS 'B'; EXCEPTION WHEN others THEN NULL; END $$;
```

**RLS policies that reference new enum values must cast to text:**

```sql
-- ❌ Fails with 55P04 "unsafe use of new enum value" in same transaction
USING (status IN ('NEW_VALUE', 'OTHER'))

-- ✅ Works — text comparison sidesteps the same-transaction restriction
USING (status::text IN ('NEW_VALUE', 'OTHER'))
```

**General idempotency checklist for migrations:**

- `CREATE TABLE IF NOT EXISTS`
- `CREATE INDEX IF NOT EXISTS`
- `CREATE OR REPLACE FUNCTION` (already idempotent)
- Trigger: wrap in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL END $$`
- Policies: `DROP POLICY IF EXISTS` before `CREATE POLICY`

# LESSONS_LEARNED Append — Stripe Webhook Debugging (2026-03-03)

Copy-paste these two entries to the bottom of `docs/LESSONS_LEARNED.md`.

---

## Supabase Edge Functions — External Webhook Endpoints Need --no-verify-jwt

**Date:** 2026-03-03  
**Module:** Payment Webhook

Supabase Edge Functions require a valid Supabase JWT by default. External services
(Stripe, NOWPayments, CCBill, PaymentCloud, Signature) cannot provide one — they're
not Supabase clients. Any function that receives webhooks from an external processor
must be deployed with:

```bash
npx supabase functions deploy <function-name> --no-verify-jwt
```

This does NOT remove security. The processor's own signature verification (e.g., Stripe's
HMAC signature check) IS the security layer. JWT is for internal Supabase clients only.

**Rule of thumb:**

- External webhook receiver → `--no-verify-jwt`
- Internal function (called from your own frontend/backend) → keep JWT enabled

**Affected functions in this project:**

- `payment-webhook` (handles all 5 processors)
- Any future NFC verification inbound webhooks

---

## Deno + Stripe — Use constructEventAsync, Not constructEvent

**Date:** 2026-03-03  
**Module:** StripeProcessor / payment-webhook

Stripe's synchronous `webhooks.constructEvent()` internally uses Node's
`crypto.timingSafeEqual`. In Deno's Node compatibility layer this silently fails
signature verification — it doesn't throw, it just returns invalid, making it
look exactly like a wrong webhook secret.

**Symptoms that indicate this bug:**

- Webhook secret is confirmed correct
- `req.text()` is being used (not `req.json()`)
- Body and signature are arriving intact in logs
- Signature verification still fails every time

**Fix — always use the async version in Deno:**

```typescript
// ❌ Node only — silently fails in Deno
event = this.stripe.webhooks.constructEvent(body, signature, webhookSecret);

// ✅ Works in Deno, Node, and edge runtimes
event = await this.stripe.webhooks.constructEventAsync(
  body,
  signature,
  webhookSecret,
);
```

The async version uses the Web Crypto API (`crypto.subtle`) which is native to Deno
and all modern edge runtimes. It's also the version Stripe's own Deno examples use.

**If you ever add another Stripe webhook handler in a Deno Edge Function, use
`constructEventAsync` from the start.**
