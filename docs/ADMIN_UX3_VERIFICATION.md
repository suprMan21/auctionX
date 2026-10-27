# Admin console UX-3: dashboard growth, grouped nav, Settings, audit links, phone polish (2026-10-27)

Branch `feature/admin-ux3` (`80db311`), merged into `dev` (`08b799e`). Third of three admin console UX sessions.
Feature Backlog card "Admin console UX-3" (AC 1 to 6). Rule (Locked 2026-10-26): every admin task in 2 to 3 clicks,
complete at the end; click cuts never remove a safety step.

## What changed

- **AC 1, grouped nav.** Dashboard on top, then **Queues** (Re-issues, Stuck payments, Creator ID checks),
  **Records** (Tokens, Accounts, Audit log; parked marketplace items when on), **Settings**, **System** (System
  health). Each group is a headed list. Items still show by permission.
- **AC 2, Settings page** (`/admin/settings`, `pages/AdminSettingsPage.tsx`): Pricing and Free transfers
  (manage_pricing) and Account deletion (view_users to see, manage_admins to change) as sections on **one page**
  with jump links. Tabs were tried first and dropped: they made the delete waiting time 4 clicks. `?tab=` scrolls
  to a section; sections the role cannot open are not rendered (and make no request). `/admin/pricing` and
  `/admin/vouchers` redirect to their section. The delete
  waiting time card left the Accounts page. Support sees Settings with Account deletion only (read-only).
- **AC 3, links.** Audit log Target and dashboard Recent activity open their record (`lib/recordLinks.ts`): account,
  staff member, token, re-issue (`?request=`), price / free transfers / delete time (their Settings section); stuck payment
  opens the Stuck payments list (no per-payment page yet). A link shows only to staff who may open that page;
  searches have no record and stay plain. Token page: "Full audit history for this token" (`?target=`). Account
  page: Free transfers section (manage_pricing): "Show free transfers" (the server audit-logs the email lookup, so
  nothing loads until clicked) and "Grant free transfers…" (the usual dialog, email filled in, typed reason kept).
- **AC 4, phone.** Search box takes its own row under 640px (Tokens and every list using `AdminSearchBox`); token
  page title and action buttons wrap; the phone menu is a modal dialog: focus moves in, Tab and Shift+Tab stay
  inside, Escape closes it and focus returns to the menu button (`aria-expanded` on the button). Re-issue cards have
  **Refresh photos**: fetches new 5-minute links for the same list without a spinner; failure keeps the old photos
  and says so.
- **AC 6, dashboard growth.** Tokens (Added today, Active) and Accounts (New today, Active) tiles open
  `/admin/tags?status=ACTIVE` / `/admin/users?status=active` (Added / New today open the list). Each has a chart:
  **Month** (last 30 local days, by day), **Year** (last 12 months from the 1st, by month), **Custom** (from/to;
  up to 92 days by day, longer by month, at most 5 years; reversed range refused before any request). **New** shows
  columns per period, **Total** a running total (one axis; never both). Shown by permission: tokens to manage_nfc,
  accounts to view_users. The Accounts total stat card is replaced by the tiles.
  - Chart (`components/GrowthChart.tsx`): hand-drawn SVG, no chart library added. Per the dataviz skill: colour
    `#8b5cf6` ran through the palette validator against the dark card surface (all checks pass; `#a78bfa` failed
    lightness); columns ≤ 24px with 4px rounded tops and a 2px gap; 1px grid; text in gray, never the series
    colour; hover tooltip over the whole column band; "Show as table" has every value; x labels spaced by pixels
    (≥ 64px) so they never overlap at 375px. Screenshot-checked at 1280px and 375px (no horizontal scroll, no
    console errors).
  - Backend: `GET /api/v1/admin/stats/growth?series&from&to&bucket&tz` (`controllers/adminStatsController.ts`,
    `lib/admin/growthStats.ts`, `routes/admin/stats.ts`) → `admin_growth_series()` (migration
    `20261027000001`). Counts only; the reply is rebuilt field by field. Permission per series checked in the API
    and again in the function (`admin_actor_email`). Zod `.strict()`: real dates, from ≤ to, ≤ 366 days by day,
    ≤ 60 months by month, valid IANA zone. Buckets start at the viewer's local midnight (DST included); for month
    view `totalBefore` counts up to the 1st of the first month. No audit row (no person-level data).

## Security

- New SECURITY DEFINER function: `REVOKE ALL … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role`
  in the same migration. Live: `has_function_privilege` false for anon and authenticated; POST
  `/rest/v1/rpc/admin_growth_series` with the publishable key → **42501**.
- Endpoint sits behind `verifyAdminAuth` + `adminRateLimit`; raw database errors never reach the client.
- **No-private-fields test** (`backend/src/__tests__/adminStats.test.ts`): an email, UUIDs, a UID, a serial and a
  chip name injected into the mocked function result never reach the response.
- No action lost a safety step: grant from an account page still needs the typed reason; nothing else changed in
  any dialog. Settings sections and links are display only; every API keeps its own permission check.

## Click counts (AC 5, from where staff start)

| Task | Clicks |
|------|--------|
| Change a price | 3: Settings, Change on the card, Confirm (+ typing the reason) |
| Grant free transfers to an account | 2 from the account page: Grant…, Confirm (email filled in) |
| Revoke free transfers | 3: Settings, Revoke on the row, Confirm |
| Change the delete waiting time | 3: Settings, Change, Save (super_admin, typed reason) |
| Open a token's full audit history | 1 from the token page |
| Open the record behind an audit row | 1 |
| Open active tokens / active accounts from the dashboard | 1 |
| See a year of growth | 1 (Year) |
| Re-issue: new photo links | 1 (Refresh photos) |
| Suspend / reset / re-issue / refund / roles | unchanged from UX-2 (≤ 3) |

## Tests

- Backend: tsc 0; vitest **818 passed / 21 skipped** (+27 in `adminStats.test.ts`).
- Frontend: tsc 0; vitest **289 passed** (+18: `adminUx3.test.tsx` 16, re-issue Refresh photos 2; nav tests updated
  for the groups and Settings); eslint 0 on `src/features/admin` + `App.tsx`.
- Live DB (`supabase/tests/admin_ux3_growth_live.sql`, rolled back): dry run before `db push` **16/16**, again after
  **16/16**. Covers lockdown, refusals (non-admin, reversed, over cap, bad zone, NULLs), 30-day and 12-month
  zero-filled series, the Toronto midnight bucket, the Nov 1 clock change, totalBefore, active counts, and a
  support role allowed accounts but refused tokens.

## Deploy / Boss steps

1. `git push origin dev` (backend auto-deploy; then `scripts/verify-backend-deploy.sh`, and probe
   `GET /api/v1/admin/stats/growth` returns 401 without a token).
2. `scripts/deploy-frontend.sh staging`.
3. Click-through: dashboard tiles + Month / Year / Custom / Total, Settings sections, an audit Target link, account page
   Free transfers, phone menu (Escape), Refresh photos.

Migration `20261027000001` is already applied to staging (2026-10-27).
