# Account types: Collector / Creator (2026-10-27)

Branch `feature/account-types` (`3e595ae`, `4a48df6`, `fa14428`), merged into `dev` (`090afc7`, `03fce58`).
Asked for by Boss mid-session ("accounts should say the different type, creator vs collector").

## Rules (Boss, 2026-10-27)

- Every account is a **Collector**. The user picks at sign-up or in settings.
- Collector to **Creator** needs a passed **Yoti identity check**.
- **Admins and super admins can override** that in the admin console.
- Staff is not an account type; it stays the staff role. Authenticator / Manufacturer / Partner are deferred past MVP.

## Data model (migrations `20261027000002`, `20261027000003`)

- `users.account_type` (`collector` | `creator`, NOT NULL, default collector) is **written only by the trigger
  `users_derive_account_type`**: Creator when `creator_override_at` is set, or when `creator_requested_at` is set
  AND `seller_verification_status` is VERIFIED or APPROVED. Anything else, including a direct write, is
  Collector. Users cannot write the column (the S-SEC column grant does not include it).
- `users.creator_requested_at`: the request. Set by sign-up metadata `account_intent = 'creator'`
  (`handle_new_user`, now with `search_path` pinned), by `request_creator_account(p_user)`, or by staff.
- `users.creator_override_at` / `creator_override_by`: staff skipped the check (CHECK: both or neither).
- A Yoti check done for another purpose (age gate, Premier) never makes a Creator by itself: no request.
- Revoking the check returns the account to Collector unless staff overrode.
- Backfill: Creator only for accounts with a completed Yoti `seller_kyc`/`both` session and a verified status
  (staging: `test@`). The legacy document pipeline (parked) does not count, so Boss's personal account
  (APPROVED via that pipeline) stays Collector.

## API

- `POST /api/v1/verification/creator-request` (signed-in user; shares the 5/min Yoti start limit).
- `GET /api/v1/verification/status` now returns `account_type`, `creator_requested_at`.
- `GET /api/v1/admin/users?type=all|collector|creator|creator_pending` (`admin_search_accounts` gains `p_type`;
  the old 5-argument function is dropped). Rows carry `account_type`, `creator_pending`, `creator_override`.
- `GET /api/v1/admin/users/:id` adds `account_type`, `creator_requested_at`, `creator_check_status`,
  `creator_override_at`, `creator_override_by_email` (`admin_get_account` now wraps `admin_get_account_base`).
- `PUT /api/v1/admin/users/:id/type` `{ type, override, reason }`: `manage_creator_ids` (admin, super_admin) in the
  route and in `admin_set_account_type`; own account refused; reason ≥ 10 chars; `no_change` refused; audit
  action `account_type_change` (from, to, override, pending, check status, reason).

## Screens

- **Sign-up:** "I'm joining as: A collector / A creator" (collector default). Creator lands on
  `/settings/account-type`. Copy no longer says "start bidding"; a signed-in visitor goes to My Tokens, not the
  parked `/my-listings`.
- **`/settings/account-type`** (linked from Profile): You're a collector / creator; **Become a creator** records the
  request and starts the Yoti check (`seller_kyc`, returns to `?returned=1` and polls ~30 s); already verified
  skips Yoti; checks switched off keeps the request; rejected offers Try again; flagged/revoked points to
  hello@authentic-materials.com.
- **Admin Accounts:** Type column (Collector / Creator / Creator (verifying) / Creator (set by staff)) and a type
  filter (`?type=`). **Account page:** type badge, Creator request, Creator ID check, "ID check skipped by …",
  and **Change account type…** (admin + super admin, not own account): Collector / Creator (needs the check) /
  Creator now, skip the ID check. 3 clicks + reason.

## Verification

| Check | Result |
|---|---|
| Dry run (BEGIN + migration + live checks + ROLLBACK) | both migrations; rollback confirmed |
| `supabase/tests/account_types_live.sql` | 14/14 |
| `supabase/tests/account_type_staff_live.sql` | 13/13 |
| Backend `tsc` + vitest | 0 errors; 829 passed / 21 skipped (was 818) |
| Frontend `tsc` + vitest | 0 errors; 318 passed (was 289) |
| Types regenerated (both sides) | also picked up `admin_growth_series` + creator ID permissions, missing since UX-3 |

## Open

- Boss click-through on staging (after `deploy-frontend.sh staging`): sign up a throwaway as a creator; Accounts
  type filter; Change account type on test2@ with the override.
- Before real users: Yoti items still open (DR-15 retention A/B/C, biometric consent, Quebec s.44 declaration).
- `POST /verification/start` accepts any `return_url` (pre-existing; the user only redirects themselves).
  Restrict to the app origin when Yoti goes live.
- The parked `/seller/verification` page and the old "seller" notification copy remain for the marketplace.
