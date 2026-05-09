# Phase 7C — Escrow Reconciliation: Verification

**Date:** 2026-05-09
**Branch:** merged into `dev` via PR-style merge commit `4907600` (feat) + `ab410f9` (RLS fix) + `b36b8e2` (merge commit). Local `dev` is ahead of `origin/dev` by 14 commits — Boss to push manually.

## What shipped

| Layer | Artifact | Status |
|-------|----------|--------|
| Migration | `supabase/migrations/20260509150005_escrow_reconciliation.sql` | ✅ Applied to staging via Supabase MCP |
| Postgres extensions | `pg_cron`, `pg_net` | ✅ Enabled (`CREATE EXTENSION IF NOT EXISTS`) |
| Enum value | `manage_escrow` added to `admin_permission` | ✅ Verified via `pg_enum` query |
| Table | `public.escrow_reconciliation_logs` | ✅ Created with RLS gated on `is_admin_with_permission(auth.uid(), 'manage_escrow')` |
| pg_cron job | `reconcile-escrow-daily` @ `0 2 * * *` | ✅ Scheduled (verified via `cron.job` query) |
| Edge function | `reconcile-escrow` | ✅ Deployed (id `dc2c2f3d-2760-4d40-9ff3-565d2e38b0d5`, version 2, `verify_jwt: true`) |
| Backend API | `GET/POST /api/v1/admin/escrow/{,summary,reconciliation-logs,:id/release}` | ✅ Routes mounted, gated by `requirePermission('manage_escrow')` |
| Frontend | `/admin/escrow` page + sidebar nav entry | ✅ TypeScript clean, route registered |
| Types | `database.types.ts` regenerated (frontend + backend) | ✅ |

## End-to-end smoke test (2026-05-09 19:26 UTC)

```
$ curl -X POST https://pmlofthmobglcfkqjtru.supabase.co/functions/v1/reconcile-escrow ...
{"ok":true,"runAt":"2026-05-09T19:26:24.190Z","totalChecked":0,"stuckReleased":0,"orphanedFlagged":0,"disputedAged":0,"errors":0}
HTTP 200
```

Confirmed downstream: row landed in `escrow_reconciliation_logs`:
```
run_at: 2026-05-09 19:26:24.19+00
total_checked: 0, stuck_released: 0, orphaned_flagged: 0, disputed_aged: 0
summary: "No errors."
```

## Outstanding (Boss action)

1. **Add Vault secrets** — required for the daily pg_cron job to actually call the function. Without these, the cron fires at 02:00 UTC but `vault.decrypted_secrets` returns NULL → `net.http_post` gets NULL URL → no HTTP call made. Run in [Supabase SQL editor](https://supabase.com/dashboard/project/pmlofthmobglcfkqjtru/sql):
   ```sql
   SELECT vault.create_secret('https://pmlofthmobglcfkqjtru.supabase.co', 'supabase_url', 'pg_cron URL');
   SELECT vault.create_secret('<service-role-key from 1P>', 'service_role_key', 'pg_cron auth');
   ```
2. **Push dev to origin** — auto-mode classifier blocked the push from this session: `git push origin dev` from `unmentionables/Unmen/`.
3. **Grant `manage_escrow` permission to admin role(s)** — the enum value exists but no admin role has it yet, so the dashboard will return 403 until granted. Pattern from prior `review_sellers` migration (`20260320000003_grant_review_sellers_permission.sql`): write a small migration that does `UPDATE admin_roles SET permissions = array_append(permissions, 'manage_escrow'::admin_permission) WHERE name = 'super_admin';` (or the appropriate role).

## Notable decisions

- **Vault over GUC for pg_cron credentials** — chose `supabase_vault.decrypted_secrets` over `current_setting('app.*')` GUCs because Vault is the supported, supported-by-Supabase pattern (GUCs require ALTER DATABASE which is locked down on managed Postgres).
- **`is_admin_with_permission(uuid, text)` for RLS** — the project's `admin_users` table is keyed by `admin_id`, not `user_id`, and permissions live on `admin_roles` via `role_id`. Going through the existing helper avoids coupling this migration to that join shape and sidesteps the same-transaction enum cast pitfall.
- **In-app notifications only** for orphan alerts — keeps reconcile-escrow free of any dependency on the 7E Postmark helper. Boss can opt into emails for super-admins later.
- **`verify_jwt: true`** on reconcile-escrow (matches release-escrow). Service-role bearer from pg_cron passes verification.

## Deferred

- Real Stripe Connect transfer in `release-escrow` and the manual-release endpoint (still creates `payouts` rows with `status: PENDING` then flipped to `PROCESSING`, but no actual funds move). Scope of Phase 7D.
- Email alerts to super-admins when orphans are detected (currently in-app only).
