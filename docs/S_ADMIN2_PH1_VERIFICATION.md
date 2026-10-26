# S-ADMIN2 Ph1 — accounts, roles and permissions — verification (2026-10-25)

Branch `feature/s-admin2-ph1`. Feature Backlog card "S-ADMIN2 — Admin Console: users, roles & permissions"
(acceptance criteria 1–11). Built on the S-SEC hotfix (`20261025000001`).

## Boss decisions (2026-10-25)

| Question | Decision |
|----------|----------|
| Account actions | **Suspend** (temporary) + **Retire** (step 1 of the Locked two-step delete). Ban dropped. |
| Staff model | **admin_users only.** `users.role` is a mirror kept by `admin_set_account_role`; nothing new reads it. Legacy marketplace policies on `users.role` left alone (parked). |
| Grantable roles | **super_admin, admin, support.** moderator/analyst stay in the table, not offered. |
| Admin MFA (AC 5) | **Flag, off**: `FEATURE_REQUIRE_ADMIN_2FA`; enrolment comes with S-2FA. |

## What changed

### Database (`20261025000002`, `20261025000003`)

- New permissions `reapply_payments`, `refund_token_fees`, `manage_pricing` (own file: an enum value cannot be
  used in the transaction that adds it). Role sets after the migration:
  - super_admin: everything.
  - admin: `view_users, manage_users, view_audit_logs, manage_nfc, reapply_payments, refund_token_fees, manage_pricing`.
  - support: `view_users, reapply_payments` (+ marketplace-era view/process_refunds, unused).
- `users.retired_at / retired_by / retire_reason`; `account_settings` (one row, `delete_window_hours`
  default 24, CHECK 1–8760; RLS on, no client grants).
- Functions (all SECURITY DEFINER, `search_path = public`, service_role only, permission re-checked inside,
  exactly one `audit_logs` row each):

| Function | Permission | Audit action |
|----------|-----------|--------------|
| `admin_suspend_account` | manage_users | `account_suspend` |
| `admin_unsuspend_account` | manage_users | `account_unsuspend` |
| `admin_retire_account` | manage_users | `account_retire` |
| `admin_reactivate_account` | manage_users | `account_reactivate` |
| `admin_delete_account` | manage_admins | `account_delete` (email domain only) |
| `admin_set_account_role` | manage_admins | `role_grant` / `role_change` / `role_revoke` |
| `admin_set_delete_window` | manage_admins | `delete_window_set` |
| `admin_search_accounts` | view_users | `user_search` (non-empty searches, written first) |
| `admin_get_account` | view_users | — |
| `admin_get_account_tokens` | manage_nfc | `user_tokens_view` (written first) |

- Rules enforced in SQL: nobody acts on their own account (so the last super_admin cannot be locked out);
  acting on a staff account needs manage_admins; a suspended or retired admin loses every permission at once;
  reason ≥ 10 characters.
- Suspend / Retire set `auth.users.banned_until` and delete `auth.sessions` + refresh tokens **in the same
  transaction**. Retire also turns off `admin_users` and resets the `users.role` mirror. Reactivate does not
  restore admin access.
- Delete: super_admin, typed confirmation (email part before `@`), only after the window, and refused while the
  account owns tokens, **created tokens** (`nfc_tags.seller_id` cascades on auth-user delete), has a pending
  transfer, is an actor in `audit_logs`, or **any other row references it** (checked from the catalog over every
  foreign key to `users` / `auth.users`; only notifications, preferences, saved searches, shipping addresses,
  voucher grants and scan history may go with the account). Deletes `public.users` and `auth.users` together.
- Every account/role change takes one advisory lock before the actor check (no two super_admins can remove each
  other at once). Reactivating an account retired with a staff role needs manage_admins.
- Accounts already banned for decades (9b9e, retired by hand 2026-10-25) are backfilled as retired.
- `payment_admin_actor_email` and the four pricing/voucher functions now check permissions.
- Dropped (AC 10): `suspend_user`, `unsuspend_user`, `ban_user`, `unban_user`, `deactivate_admin`,
  `reactivate_admin`, `revoke_admin_session` (double audit rows; target recorded as actor; no audit on reactivate).

### Backend

- `lib/admin/permissions.ts`: one permission list; pricing, vouchers and stuck payments gate on permissions.
- `requireAuth` and `verifyAdminAuth` refuse suspended/retired accounts (`account_status_of`), **fail closed**
  (503) if the status cannot be read.
- `verifyAdminAuth`: AAL2 required when `FEATURE_REQUIRE_ADMIN_2FA` is on (code `ADMIN_2FA_REQUIRED`).
- `requirePermission` 403 no longer lists the admin's permissions.
- New routes: `GET /admin/me`, `/admin/users` (search, detail, tokens, suspend, unsuspend, retire, reactivate,
  delete, role), `/admin/account-settings`, `/admin/audit-logs` (+ `target` filter, `/facets`). Old user search
  (unescaped `.or()` filter, `select('*')` incl. Stripe/Yoti ids) and the ban routes are gone.

### Frontend

- Console gets role + permissions from `GET /admin/me`; nav, routes and buttons gate on permissions.
- Users list (search, status/staff filters, role column, delete-window card), account detail (actions by
  permission and status, delete blockers in plain words, tokens on request), audit log dropdowns + target filter.
- Profile save / Skip land on My Tokens (AC 11).

## Acceptance criteria

| AC | Status | Evidence |
|----|--------|----------|
| 1 Only super_admin grants/revokes roles; no self-elevation | ✅ | live checks 05–07, 24, 29; route gate tests |
| 2 Suspended accounts cannot sign in or act on tokens; tokens still verify | ✅ code / ⏳ live | checks 09, 11; requireAuth tests; live token-holder probe pending |
| 3 Every role/permission change and suspension audited with a reason | ✅ | one audit row per action, reason required (checks 05, 08–17, 24) |
| 4 Token holdings need manage_nfc and are logged | ✅ | check 22; frontend tokens tests |
| 5 Admin AAL2 behind a flag | ✅ (flag off) | `FEATURE_REQUIRE_ADMIN_2FA`; guard test for `ADMIN_2FA_REQUIRED` |
| 6 RLS/grants reviewed; every SECURITY DEFINER revoked from PUBLIC/anon/authenticated | ✅ | check 01 (22 functions), 04, 26 |
| 7 tsc, vitest, lint green | ✅ | see Tests |
| 8 Two-step Retire → Delete | ✅ | checks 14, 17, 18, 19, 28, 30–33 |
| 9 One permission model, permissions exposed to frontend | ✅ | `/admin/me`; no role-name gates left (backend grep) |
| 10 Legacy suspend/ban RPCs replaced; one audit row | ✅ | check 02; users route has no audit middleware |
| 11 Profile save no longer goes to /my-listings | ✅ | `afterProfileLanding` test |

## Tests

- **Dry run** (`BEGIN` + `20261025000003` + live checks + `ROLLBACK`): `s_admin2_accounts_live.sql` **33/33 ok**
  (prints a compact summary: the error text is length-limited and was hiding the two longest check names).
  Caught one bug first (text-array append in `account_delete_blockers`). Nothing persisted (checked).
- **Independent security review** of the diff (subagent, read-only): no auth bypass or escalation. Fixed:
  (1) Delete could cascade other users' parked marketplace / messaging rows → catalog-wide linked-records
  blocker; (2) concurrent super_admin race → advisory lock; (3) plain admin could undo a super_admin's
  retirement of ex-staff → needs manage_admins. Accepted: an access token issued before a suspend still reads
  own-row data straight from Supabase until it expires (≤ 1 h); every backend action is refused.
- Existing live suites on top of the migration (dry run): hotfix 11/11, Ph3a 26/26, Ph3b 23/23, Ph2 19/19,
  chip names 17/17. Hotfix suite updated: dropped functions count as locked.
- `20261025000002` (enum values only) was applied to staging ahead of the dry run with `supabase db query`;
  `db push` re-runs it as a no-op and records it.
- **Correctness review** (three read-only subagents: DB, backend, frontend). Fixed:
  - DB: accounts retired by hand before S-ADMIN2 (9b9e) had no record of their staff role, so a plain admin could
    reactivate them → `users.retired_role` (set on retire and by the backfill, which also turns off leftover
    `admin_users` rows); reactivate checks it. Backfill also covers legacy `is_banned` (0 on staging). An expired
    suspension can be lifted (clears leftovers). Delete preview counts references to the staff row
    (`moderation_queue`, `users.banned_by`, `admin_users.assigned_by`). Checks 30–33.
  - Backend: audit-log page past the end → empty page, not 503 (PGRST103). Retire / reactivate / delete / role /
    delete-window share the destructive rate limit, one bucket per admin. `requireAuth` codes now
    `ACCOUNT_INACTIVE` / `UNAVAILABLE` (same as the admin guard). New `adminAuthGuard.test.ts` covers the admin
    guard's status, 2FA flag, rate limit and audit paging.
  - Frontend: super admin can remove the role of a suspended/retired staff account; Reactivate hidden (with the
    reason) when it needs a super admin; a 401 signs out instead of going home; Try again on the unavailable
    screen; pending search no longer navigates after leaving the list; unknown `?status=` ignored; search box
    follows Back/Forward; detail page resets per account; tags / re-issue / stuck payments / verifications routes
    gated by permission; dashboard loads each panel by permission and skips parked marketplace endpoints.
- Backend: tsc 0; vitest **773 passed / 21 skipped** (+60 `adminAccounts.test.ts`, +13 `adminAuthGuard.test.ts`;
  payment/pricing tests moved to permissions).
- Frontend: tsc 0; vitest **212 passed** (+25 `adminAccounts.test.tsx`); eslint 0 errors in touched files
  (repo baseline has 36 pre-existing errors elsewhere).

## Follow-up: forced sign-out on revoke (2026-10-26, `20261026000001`)

Live test: test2@ (support) stayed in the console after the role was revoked. The server held: every admin request
was refused (`admin_users.last_active_at` 04:13:17 UTC, revoke 04:13:33, nothing after), but the browser kept
showing the console with the permissions it loaded at sign-in.

- DB: `admin_set_account_role` now ends every session and refresh token when a role is **changed or revoked**
  (`admin_end_sessions`, as suspend / retire do); a grant does not. Audit `changes.sessions_ended`. Live check 34
  (fails without the migration, passes with it).
- Console: `AdminProtectedRoute` re-checks `GET /admin/me` every minute, when the tab regains focus, and straight
  after any admin request the server refuses (401/403, `onAdminRequestRefused`). Access gone → toast + sign out →
  /login. Changed role → the console follows the new permissions. Network blips keep the console (the server
  still refuses). Frontend 219 tests.

## Deploy order (matters)

1. `supabase db push --linked` (both migrations). **Before** the backend: `requireAuth` fails closed, so a backend
   without `account_status_of` answers 503 to every signed-in request.
2. Live checks: `supabase db query --linked -f supabase/tests/s_admin2_accounts_live.sql` (and the hotfix suite).
3. Regenerate `database.types.ts` (both sides).
4. `git push` → confirm App Runner deploy (`scripts/verify-backend-deploy.sh`), probe `GET /api/v1/admin/me` (401 not 404).
5. `scripts/deploy-frontend.sh staging` right after: the old Users page sends `search=` which the new API refuses.

## Live verification (2026-10-26, Toronto evening of 2026-10-25)

- [x] `db push` (`20261025000002/3`, then `20261026000001`); live suite on staging **34/34**, older suites pass;
      backfill: 9b9e retired with `retired_role = super_admin`, 2b3f only active staff. Types regenerated.
- [x] Backend deployed (`/admin/me` → 401), frontend deployed (bundle has the new console).
- [x] Suspend test@ 1 h ("testing suspension", 04:17:58 UTC): 2 sessions ended; sign-in refused ("User is banned");
      chip_004 tap verified 04:18:24 (CMAC valid) during the suspension; lifted 04:18:50, account clean.
- [x] Support role on test2@ granted 04:12:46, revoked 04:13:33: no admin request accepted after the revoke
      (`last_active_at` 04:13:17), but the console stayed open → follow-up `20261026000001` (above).
- [x] Retest on test@ (grant 04:56:01, revoke 04:56:41, `sessions_ended: 1`): signed out of the console.
- [x] Console click-through as super_admin.
