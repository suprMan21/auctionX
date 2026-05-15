# Session 20 — Admin Listings & Auctions Management

**For:** claude.ai (Claude Code) building this out in a fresh session.
**Created:** 2026-05-15 by session 19 wrap-up.
**Scope:** ONE session. Strict in/out boundaries below — don't expand without checking with Boss.

---

## Read these FIRST (in order)

1. `CLAUDE.md` (`/Volumes/myDev_Drive/Dev/dev/projectClaude/CLAUDE.md`) — version 28.0 — current project state, conventions, session-end workflow.
2. **This file** — full scope + acceptance criteria.
3. `docs/SESSION_19_VERIFICATION.md` — what shipped immediately before; explains the marketplace loop context.
4. `docs/MODULE_7D_VERIFICATION.md` (optional but useful) — full Stripe Connect / Phase 7D context.

Project root: `/Volumes/myDev_Drive/Dev/dev/projectClaude/unmentionables/Unmen/`. ALL commands run from there.

---

## The Problem

Admin has no way to view or manage listings or auctions from the admin dashboard.

The admin section (`/admin`, routes in `frontend/src/App.tsx:279`) currently has:
- Dashboard, Users, User Detail
- Moderation (only handles **flagged** listings via the `moderation_queue` table — not a general listings view)
- Seller Verification, Escrow, Audit Logs, Health

There's a backend admin endpoint `POST /api/v1/admin/auctions/:id/settle` (defined in `backend/src/routes/admin/settlements.ts`) but **no list or detail endpoints**, and **no UI**. Boss surfaced this gap in session 19 — they want to see all active auctions in one place, with admin-only controls.

Schema reminder: a listing has exactly one auction (1:1, FK `auctions.listing_id`). So "listings" and "auctions" can be presented in a unified table.

---

## Goals (acceptance criteria)

End the session with these artifacts working on staging:

1. **`/admin/auctions` page** — unified table that joins listings + auctions:
   - Columns: thumbnail, title (links to public `/listings/:id`), seller display_name, current bid, reserve, status (auction status badge: DRAFT/ACTIVE/ENDED/SETTLED/CANCELLED), bid count, end_time (relative + absolute on hover), created_at.
   - Filters: auction status (multi-select), brand (AUCTIONX / AUTHENTIC_MATERIALS), seller (search by display_name OR seller_id), category.
   - Search: free-text on listing title (debounced 300ms, ilike `%query%`).
   - Sort: end_time asc/desc, current_price_cents desc, created_at desc. Default: end_time asc (soonest-ending first).
   - Pagination: 25/page, page numbers + prev/next.
   - URL-synced via `useSearchParams` (mirror pattern from `AdminUsersPage`).
   - Loading state, empty state, error state — all rendered with the project's glass styling.

2. **`/admin/auctions/:id` detail page**:
   - Header: title, status badge, links to seller + public listing page.
   - Sections: listing summary (title/description/media), auction state (current/reserve/min increment/start/end), bid history (table, latest first, columns: bidder display_name, amount, max_bid if visible to admin, placed_at), settlement state if any (status, payout state).
   - **Admin actions** (each behind a `window.confirm` + audit-log entry via existing audit middleware):
     - **End auction now** — sets `auctions.status='ENDED'`, `end_time=NOW() - 1 second`. Only valid when `auction.status='ACTIVE'`.
     - **Cancel auction** — sets `auctions.status='CANCELLED'`, `listings.status='CANCELLED'`. Disallow if status is SETTLED or has any successful transactions.
     - **Force-settle** — POSTs to the existing `/admin/auctions/:id/settle` endpoint. Disallow if status is not ENDED.
   - All admin actions write to `audit_logs` (existing middleware).
   - All admin actions return updated row; UI refetches via React state update.

3. **`AdminLayout` nav** — add an "Auctions" entry between "Moderation" and "Escrow" (`frontend/src/features/admin/AdminLayout.tsx:22-53`, the `NAV_ITEMS` array). Use an appropriate icon path (gavel/auction iconography — pick a Heroicons-style path that fits).

4. **Backend endpoints** (in `backend/src/`):
   - `GET /api/v1/admin/listings` — paginated list with joined auction summary. Query params: `page`, `limit`, `status`, `brand`, `category`, `seller`, `search`, `sort`. Response shape: `{ success: true, data: { results: Listing[], total: number, page: number, totalPages: number } }`.
   - `GET /api/v1/admin/listings/:id` — full detail (listing + auction + bids + settlement summary).
   - `POST /api/v1/admin/auctions/:id/end` — force-end. Body: none. Validates status precondition. Updates row, writes audit log entry.
   - `POST /api/v1/admin/auctions/:id/cancel` — cancel. Body: `{ reason: string }`. Validates status precondition. Updates listing + auction rows in a single transaction (use Supabase RPC OR sequential updates with rollback on failure — pick the cleaner option).
   - **Reuse existing** `POST /api/v1/admin/auctions/:id/settle` (already routed in `backend/src/routes/admin/settlements.ts`).
   - All routes mount under the existing admin router (`backend/src/routes/admin/index.ts`), which already enforces `verifyAdminAuth` + `adminRateLimit`.

5. **Frontend API client** — extend `frontend/src/features/admin/api/adminApi.ts` with:
   - `getListings(params)`, `getListingDetail(id)`, `endAuction(id)`, `cancelAuction(id, reason)`, `triggerSettle(id)`.
   - Mirror the `adminFetch<T>` pattern already in that file.

6. **Type definitions** in `frontend/src/features/admin/types/admin.ts`:
   - `AdminListing`, `AdminListingDetail`, `AdminListingsResponse`.
   - Reuse `Database['public']['Tables']['listings']['Row']` and `Database['public']['Tables']['auctions']['Row']` from `frontend/src/types/database.types.ts` — do NOT redeclare those columns.

---

## Out of scope (explicit — do NOT do these)

- Stripe Elements / Pay Now wire-up. Separate session (will need `op://AM_Development/Stripe/publishable-key` first).
- Editing listing content (title, description, images) — admin can only change STATE, not content. Content edits are seller-side.
- Bulk actions (multi-select + bulk cancel). One row at a time for v1.
- A separate "Listings" admin page distinct from auctions — Boss wants one unified view. Don't split.
- New Supabase migrations. The existing schema is sufficient.
- Notification side-effects (emails to seller on cancel). Backend should write audit-log entries, and existing notification triggers (if any) will fire — don't add new ones.
- "My Purchases" buyer-side list page (also separately tracked).

---

## Existing patterns to mirror (DO NOT REINVENT)

- **Admin page layout + URL-synced search/filter/page** — read `frontend/src/features/admin/pages/AdminUsersPage.tsx` end-to-end. Same `useSearchParams` pattern, same `TierBadge`/`StatusBadge` sub-component style, same `Pagination` component (inline; copy if needed).
- **Backend admin router file shape** — read `backend/src/routes/admin/users.ts` and `backend/src/controllers/...` (the controller it imports). Same `AppError`-based error handling, same `{ success, data, error }` response envelope, same audit-log writes.
- **`adminFetch<T>`** in `frontend/src/features/admin/api/adminApi.ts` — use it; don't write a new fetch wrapper.
- **Status badge color tokens** — green (success-500) for ACTIVE/SETTLED, gray for ENDED, red (error-500) for CANCELLED. Mirror `AdminUsersPage.tsx:29-49`.
- **Glassmorphism + dark theme** — `glass rounded-2xl`, `border border-white/10`, `bg-dark-800/700`, `from-primary-500 to-accent-500` gradient buttons. See `CLAUDE.md` "Design System".
- **`window.confirm` for destructive actions** — used in session 19 for Confirm Delivery. Same pattern: native dialog, then API call with toast feedback.

---

## Files you'll create or modify

**New files:**
- `frontend/src/features/admin/pages/AdminAuctionsPage.tsx`
- `frontend/src/features/admin/pages/AdminAuctionDetailPage.tsx`
- `backend/src/routes/admin/listings.ts` (GET list + detail)
- `backend/src/routes/admin/auctions.ts` (POST end + cancel — note: this is a NEW file separate from the existing `admin/settlements.ts` which mounts `/admin/auctions/:id/settle`; you may consolidate the two into one `auctions.ts` file if it reads cleaner — Boss leaves that to your judgment)
- `backend/src/controllers/adminListingsController.ts`
- `backend/src/controllers/adminAuctionsController.ts`

**Modify:**
- `frontend/src/App.tsx` — add routes `/admin/auctions` and `/admin/auctions/:id`.
- `frontend/src/features/admin/AdminLayout.tsx` — add NAV_ITEMS entry.
- `frontend/src/features/admin/api/adminApi.ts` — add methods.
- `frontend/src/features/admin/types/admin.ts` — add types.
- `backend/src/routes/admin/index.ts` — mount the new routers. **Watch the existing line** `router.use('/auctions', adminSettlementsRouter);` — it currently routes ALL `/admin/auctions/...` to settlements; if you create a new auctions router, you'll need to either fold settle into the new file or rename the existing mount.

---

## Verification

When you claim done:

1. **Type-check** — BOTH must pass:
   ```bash
   cd frontend && npx tsc --noEmit
   cd backend && npx tsc --noEmit
   ```
2. **Vitest** (backend) — run `cd backend && npx vitest run` and add tests for the new admin auctions controllers (status precondition violations, happy path, audit-log write).
3. **Build** — `cd frontend && npm run build` (zero new warnings beyond the existing bundle-size one).
4. **Staging deploy**:
   ```bash
   cd frontend
   aws s3 sync dist/ s3://auctionx-frontend-staging --delete --profile auctionx
   aws cloudfront create-invalidation --distribution-id E3JOPXHI8DB4BE --paths "/*" --profile auctionx
   ```
   Backend redeploy is via App Runner auto-deploy on push to `dev` — no manual step.
5. **Smoke test** as Chris admin (`2b3f1532-9345-4720-8fac-55d07517c78b`):
   - Hit `/admin/auctions` — list loads, filters work, pagination works, URL sync works.
   - Click an auction row → detail page renders.
   - Test "End auction now" on an ACTIVE auction — auction flips to ENDED, audit log row written.
   - Test "Cancel auction" with a reason — listing + auction both flip to CANCELLED, audit log written.
   - Test the existing "Force-settle" path — works against an ENDED auction.
   - Verify status preconditions reject correctly (try ending a CANCELLED auction → 409 / `failed_precondition`).

---

## Critical conventions

- **TypeScript strict everywhere.** No `any` casts. If the DB type is `as never` somewhere, regenerate types first using:
  ```bash
  npx supabase gen types typescript --project-id pmlofthmobglcfkqjtru 2>/dev/null \
    | sed '/^<claude-code-hint/d' > frontend/src/types/database.types.ts \
    && cp frontend/src/types/database.types.ts backend/src/types/database.types.ts
  ```
  **The `sed` strip is mandatory** — the supabase CLI's plugin pollutes the output with an XML tag that breaks `tsc`. Lesson logged in session 19.
- **Named exports only.** No default exports.
- **Arrow function components.**
- **API response shape `{ success, data, error }`** — every endpoint.
- **`SECURITY DEFINER`** on any new RPC.
- **Audit logs**: existing middleware writes them. If you bypass it, write the audit entry explicitly (see `backend/src/middleware/auditLog.ts`).
- **No new dependencies** — work with what's installed.
- **Don't push to `dev` directly.** Branch: `feature/session-20-admin-auctions`. Commit pattern: `feat(admin): description`. Merge via CLAUDE.md session-end workflow (run TypeScript + vitest + build + deploy, write `docs/SESSION_20_VERIFICATION.md`, update `docs/TODO.md`, bump CLAUDE.md to v29 in Notion + locally, merge feature → dev, push).

---

## What success looks like in a short paragraph

"Boss logs in as admin, navigates to `/admin/auctions`, sees every auction in the system in a paginated/filterable table, clicks one, sees its detail page with the listing + bid history + settlement state, and can force-end or cancel it. The action writes to `audit_logs` and the row updates immediately. The Force-Settle button still works against ENDED auctions. Boss can now monitor and intervene on the marketplace without touching SQL."

If you finish early, the cleanest follow-up is the buyer-side **"My Purchases" list page** (`/purchases`) — but that's a stretch goal, not session 20 scope.
