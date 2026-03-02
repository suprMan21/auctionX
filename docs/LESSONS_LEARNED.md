# AuctionX — Lessons Learned

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
