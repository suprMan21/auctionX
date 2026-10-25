# S-SEC hotfix — verification (2026-10-25)

Found while scoping S-ADMIN2. Boss chose to fix before any S-ADMIN2 work.
Fix commit `58ec2c5`, merged into `dev` as `782eea9`. Migration `20261025000001_s_sec_hotfix_lockdown.sql`.

## Holes (staging, no sign of use)

| # | Hole | Evidence |
|---|------|----------|
| 1 | 11 SECURITY DEFINER functions executable by `anon`/`authenticated` with no permission check: `deactivate_admin`, `reactivate_admin`, `revoke_admin_session`, `suspend_user`, `unsuspend_user`, `ban_user`, `unban_user`, `apply_payment_penalty`, `get_next_eligible_bidder`, `calculate_processor_success_rate`, `generate_token_name` | `has_function_privilege('anon', …)` sweep; anon `deactivate_admin(super_admin)` succeeded inside a rolled-back test |
| 2 | Policy "Anyone can view users" (`USING true`): public key read every column of every user (email, phone, role, Stripe/Yoti ids) | `pg_policies` + column privileges; anon saw 6/6 rows |
| 3 | Users could UPDATE every column of their own row except `role`/`seller_tier` — incl. `email`, which `completeTransfer` used to match email-addressed transfers | `information_schema.column_privileges`; test UPDATEs allowed |

Exploitation check: no banned/suspended users, both admins active with `session_version` 0, no
`public.users.email` that differs from `auth.users.email` on a live account.

## Fix

- Functions: `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`; `GRANT … TO service_role`. RLS helpers
  `is_admin_with_permission` / `is_active_admin` stay callable (policies evaluate them as the caller).
- `users` SELECT: `users_select_own` (`id = auth.uid()`) + `users_select_staff` (`view_users`). anon keeps the
  bare SELECT privilege (other tables' policies subquery `users`) but no policy, so it sees nothing.
- `users` UPDATE by `authenticated`: column grant only — `display_name, phone_number, photo_url,
  profile_photo_url, bio, preferred_brand, updated_at`.
- Backend: `completeTransfer` uses `confirmedEmail(req.user)` (`backend/src/lib/security/confirmedEmail.ts`),
  shared with `tokenReadController`.

Consumers checked first: all backend `users` reads use the service client; frontend reads are own-row only
except parked marketplace pages (`/seller/:id`, listing seller embeds) behind `VITE_FEATURE_MARKETPLACE`.

## Tests

- Dry run (`BEGIN` + migration + checks + `ROLLBACK`) caught 42P17 infinite recursion from
  `(SELECT auth.uid())` in the new policy; fixed before apply.
- `supabase/tests/s_sec_hotfix_lockdown_live.sql`: **11/11 ok** after `db push`; against unfixed staging it
  reported 8 FAIL (proves the checks fire).
- Public-key HTTP probe after apply: `GET /rest/v1/users` → `[]`; `POST rpc/deactivate_admin`,
  `rpc/suspend_user` → `42501 permission denied`.
- Backend vitest **700 passed / 21 skipped** (+2: profile-email spoof refused, unconfirmed email refused; the
  first fails against the old controller). tsc 0 both sides.
- Boss on staging: profile display name edit saves. (The 404 after saving is the old redirect to parked
  `/my-listings`, `ProfilePage.tsx:128`, pre-existing — fix in S-ADMIN2 Ph1.)

## Account cleanup (Boss, 2026-10-25)

Each action has an `audit_logs` row under `2b3f` (Boss).

| Account | Action |
|---------|--------|
| `5fc504cc…` suprmansreal@gmail.com (user, last sign-in 2026-01-27) | Deleted: auth user (Admin API) + profile row |
| `9b9e99f1…` chris.lafleche1714@gmail.com (old super_admin) | Retired: `admin_users.is_active=false`, `session_version` bumped, sign-in banned to 2126. Kept: actor on 11 audit entries (2026-02-19 suspend/ban tests) |
| `96e8f0ee…` test@authenticmaterials.com (orphan profile, no auth user) | Profile row deleted |

After: `2b3f` is the only active admin; 4 users; 0 orphan profile rows.

## Follow-ups

- S-ADMIN2 Ph1: two-step Retire → Delete (waiting window default 24 h, super_admin can change it, minimum
  1 h; blocked while the account owns tokens or has a pending transfer; deletes auth + profile together) —
  Decisions DB 2026-10-25.
- `public.users` has no FK to `auth.users`; add it (after the two-step delete exists) or always delete both.
- S-SEC1 idea: `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` so new functions start closed.
- If the marketplace is re-activated, seller names need a narrow public profile view.
