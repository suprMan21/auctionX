# S-ADMIN1 Ph3a — Stuck payments · Verification

**Branch:** `feature/s-admin1-ph3` (from `dev` @ `35f2133`)
**Date:** 2026-10-11
**Backlog:** https://app.notion.com/p/3ee3baf69664810a888df72c1a63816f
**Decision:** "Paid-but-stuck transfers" (Locked 2026-10-03), extended to re-issue fees (Ideas DB 2026-10-09)

Status: **✅ LIVE ON STAGING, verified with sandbox money 2026-10-19 / 2026-10-25.** Migration applied (live checks
26/26 against the applied functions), merged to `dev` (`d1d166b`), backend and frontend deployed, cron ticking, GitHub
Issues filing. Results in §Live verification. Re-apply is covered by unit tests only (see §Not verified live).

---

## Decisions with Boss (2026-10-11)

1. **Ph3 is split.** Ph3a (this) = stuck-payment queue, Re-apply, refund, 10-minute sweep, GitHub Issues.
   Ph3b (next session) = admin-set prices and free-transfer vouchers.
2. **Vouchers (Ph3b) are granted to an account**: an admin grants N free transfers to a user by email, with a reason
   and optional expiry; the next fee that user would pay is skipped. No redeemable codes.
3. **A re-issue fee paid on a cancelled or changed request** shows in the queue with an **admin Refund button**.
   Nothing is refunded automatically and there is no "reinstate" action.

## What a stuck payment is

Stripe took a token fee and the row it pays for did not move. Each one is a `payment_incidents` row (one per
PaymentIntent), which is both the queue entry and the dedup key for its GitHub Issue.

| Reason | Meaning | Way out |
|---|---|---|
| `webhook_missed` | Paid; no webhook applied it | The sweep applies it by itself (the incident is recorded already closed) |
| `apply_failed` | Paid; the apply raised (missing salt key, database fault) | Stripe retry, sweep, or Re-apply |
| `no_recipient` | Paid; transfer has no resolved recipient | Recipient signs in, then Stripe retry / sweep / Re-apply |
| `not_payable` | Paid; transfer or request was cancelled or changed, or the chip is retired | Refund |
| `intent_mismatch` | Paid; the row is bound to a different PaymentIntent | Refund |
| `row_missing` | Paid; the row named in the metadata does not exist | Refund |

## What was built

**One apply, three callers.** `lib/payments/tokenFeeApply.ts` is now the only code that completes a transfer or
marks a re-issue request PAID. The webhook, the sweep and the admin Re-apply all go through it, and the writes
happen inside one database function (`apply_transfer_fee`, `apply_reissue_fee`).

**Migration `20261011000001_s_admin1_stuck_payments.sql`** (additive, idempotent):
`payment_incidents` (RLS on, no policy, no anon/authenticated grants) · `apply_transfer_fee` · `apply_reissue_fee` ·
`record_payment_incident` · `admin_reapply_payment` · `admin_refund_payment_incident` · `payment_admin_actor_email` ·
pg_cron job `token-fee-sweep-tick` (every 10 minutes; sends nothing until both Vault secrets exist).

**Backend**
- Webhook (`routes/tokenFeeWebhook.ts`) rewritten onto the shared apply. Every paid-but-unapplied outcome is
  recorded and ticketed. 500 where a Stripe retry can help (`no_recipient`, `apply_failed`), 200 where it cannot.
- Sweep (`lib/payments/tokenFeeSweep.ts`): lists Stripe PaymentIntents from the last 72 h, keeps succeeded token
  fees older than 5 minutes that are not refunded, and applies or queues each one that has not landed. Starts from
  Stripe, not from our rows, so it also catches an intent whose id was never stored.
- `POST /api/v1/internal/token-fee-sweep`: shared secret in `x-sweep-secret`, constant-time compare, 503 while
  unset, minimum 24 characters.
- Admin queue `GET /admin/stuck-payments`, `POST …/:id/reapply`, `POST …/:id/refund`, `POST …/sweep`.
  Re-apply and Refund ask Stripe for the PaymentIntent before touching anything.
- GitHub Issues (`lib/github/issues.ts`): one issue per incident on `suprMan21/auctionX`, label `stuck-payment`,
  ids only. A repeat comments at most once every 6 hours; a close comments once. Never blocks a payment path.
- Security events: `payment.reconcile`, `admin.payment_action`. `transfer.state_change.trigger` gains `sweep` and
  `reapply`.

**Frontend:** `/admin/stuck-payments` (nav: "Stuck payments"). Per payment: what went wrong, what to do, the token,
ids, the debug ticket link. Re-apply dialog (typed reason). Refund dialog (typed reason + last 6 characters of the
payment id; shown to admin and super_admin only). "Check now" runs the sweep. A warning shows when the sweep
secret or the GitHub token is not configured on the server.

## Who may do what

| Action | Roles | Enforced |
|---|---|---|
| View queue, Re-apply, Check now | support, admin, super_admin | Route (`requireAdminRole`) + database function |
| Refund | admin, super_admin | Route + controller + database function |

Keyed on the **role name**, not a permission: the seeded `support` role already carries `process_refunds` from the
parked marketplace, so that permission cannot be the refund gate (Locked: "Refunds need admin+").

## Behaviour changes to existing code (all deliberate)

1. **The transfer apply is now one transaction.** It used to be five separate writes with unchecked errors: a
   failure after the first left a COMPLETED transfer whose token had not moved, and every retry stopped at
   "already completed".
2. **A payment that lands on a CANCELLED transfer is no longer swallowed.** It was acknowledged as a lost race
   (200, nothing recorded): the payer was charged and nobody was told. It is now a `not_payable` incident.
3. **A paid transfer no longer lifts an admin suspension.** The apply used to set `lifecycle_status = ACTIVE`
   unconditionally; a SUSPENDED token now stays SUSPENDED while ownership moves.
4. **A foreign intent naming an already-completed transfer** is reported as `intent_mismatch` (stranded money), not
   as an idempotent replay.
5. **S-SEC0 invariant restated.** `transfer.state_change` with `to=COMPLETED` is legitimate for
   `trigger ∈ {webhook, sweep, reapply}`. `sweep` and `reapply` lines are always paired with a `payment.reconcile`
   event carrying the same `request_id`. Any other trigger is still Critical.

## Test results

```
backend   npx tsc --noEmit         0 errors
backend   npx vitest run           24 files · 642 passed · 21 skipped   (baseline 569 passed · 21 skipped)
frontend  npx tsc -b --noEmit      0 errors
frontend  npx vitest run           11 files · 145 passed                (baseline 132)
boundary  npm run lint:boundaries  ✔ 0 violations (153 modules, 476 dependencies cruised)
frontend  eslint (touched dirs)    0 new problems; 3 pre-existing (AdminProtectedRoute, AdminAuditLogPage,
                                   AdminUserDetailPage)
```

| Spec | Tests | Covers |
|---|---|---|
| `stuckPayments.test.ts` (new) | 58 | sweep, sweep endpoint secret, Re-apply, Refund, queue, GitHub Issue dedup, the COMPLETED invariant |
| `tokenFeeWebhook.test.ts` | 15 → 23 | incident on every stuck outcome, one incident across redeliveries, suspended stays suspended |
| `reissue.test.ts` | +1 (others extended) | paid-on-cancelled and wrong-intent go to the queue; no incident on a normal payment |
| `adminStuckPayments.test.tsx` (new) | 13 | page, both dialogs, role-dependent buttons, Check now, config warnings |

**Guards proven to fire** (each removed in turn; a test failed every time): Re-apply ignoring Stripe state ·
refund role check · refund typed confirmation · PaymentIntent-to-incident binding · 5-minute grace window ·
sweep skipping refunded payments · sweep endpoint secret · GitHub comment throttle · webhook recording incidents.

**Live database (staging), dry run:** migration + `supabase/tests/s_admin1_ph3a_live.sql` sent as one batch that
ends by raising, so everything rolled back. **26/26 ok**, and a follow-up query confirmed nothing was left
(`payment_incidents` does not exist, no seed rows). Covers: atomic rollback of the apply (forced failure at the
last write), replay, intent binding, incident dedup, born-closed incident, CHECKs with NULLs, support can Re-apply
but cannot refund, refund cancels a pending transfer, a refunded incident is never reopened, re-issue paid then
void, function and table grants, cron job scheduled, audit rows append-only.

The unit tests play the database functions with `__tests__/helpers/feeDbFake.ts`, which restates their rules in
TypeScript. That is a second copy and can drift; the live SQL file is the proof of the real functions.

## Live verification (staging, Stripe sandbox)

Every result below was read back from `payment_incidents`, `ownership_transfers`, `audit_logs`, `net._http_response`
(the cron tick responses) and the backend CloudWatch log, not from the screen.

**Deploy.** Migration applied by Boss 2026-10-14 (live checks 26/26 against the applied functions). Types regenerated
and `PENDING_MIGRATION_COLUMNS` emptied (`9c5fbc1`), merged to `dev` (`d1d166b`). App Runner deploy 20:32Z and config
updates 22:26Z / 23:55Z all SUCCEEDED. Frontend deployed 2026-10-15 00:55Z (bundle contains the page).

**Cron.** The first ticks returned `400 Bad Request` from App Runner's proxy, before reaching the backend: the Vault
sweep secret had been pasted with a leading newline. Trimmed in place (`btrim` via `vault.update_secret`); every tick
from 2026-10-14 23:40Z returns 200.

| # | Case | What happened | Result |
|---|---|---|---|
| 1 | Missed webhook (2026-10-19) | Webhook endpoint disabled. test2@ → test@ transfer `98e9e61a…` of `chip_004`, $2.50, initiated 20:13:41Z. The 20:20Z tick skipped it (`skippedRecent: 1`, inside the 5-minute grace). The 20:30Z tick applied it (`applied: 1`): transfer COMPLETED 20:30:01Z, fee paid, `chip_004` → test@. Incident `03d6e72e…` `webhook_missed`, born RESOLVED (`resolution = sweep`). GitHub Issue #2. | ✅ |
| 3 | Cron | Covered by case 1: the 10-minute tick applied the payment with nobody pressing anything; `token_fee_sweep_done {applied: 1}` logged. | ✅ |
| 2 | Paid, then cancelled → refund (2026-10-25) | Webhook disabled. test@ → test2@ transfer `25ed7af1…`, initiated 01:46:12Z, paid ~01:47Z, cancelled by the sender 01:48:01Z. The 01:50Z tick skipped it (grace). Check now at 01:54:45Z → incident `45bdc81f…` OPEN `not_payable`, Issue #3. Refund by super_admin 01:55:16Z → REFUNDED, Stripe refund `re_3UUGWOD…`, `audit_logs` `payment_refund` row (admin id, incident, intent, refund id, $2.50, reason "cancelled transfer", `transfer_cancelled: false`). Transfer stays CANCELLED, unpaid; `chip_004` stays with test@. The 02:00Z tick read the charge from Stripe as refunded (`skippedRefunded: 1`); Boss confirmed Refunded in the Stripe dashboard. No `github_issue_call_failed` logged around the refund (the close comment itself was not opened on GitHub by Claude). | ✅ |

Webhook endpoint re-enabled by Boss after case 2.

**End state:** `chip_004` is owned by **test@** (not back at test2@; a return transfer would cost another sandbox fee,
so it was left). `chip_001` untouched. Both incidents closed; nothing OPEN.

## Not verified live

- **Re-apply.** It is offered only on an OPEN incident that can still be applied, and the sweep closes those itself
  within 10 minutes, so it is hard to stage. Covered by unit tests (`stuckPayments.test.ts`) and the live SQL file
  (support can Re-apply). Boss chose to close out without it.
- A re-issue fee through the queue (unit tests and live SQL only).

## Found during the live test (backlog, not blockers)

- `token_fee_stuck` logs at ERROR even when the incident is born RESOLVED (sweep applied it). Should be WARN then.
- The close comment does not update `github_last_comment_at`, so the database cannot show it was posted; and
  `noteIncidentClosed` swallows its own exceptions without logging (HTTP failures inside `commentOnIssue` are logged).
- **Pre-existing since 2026-10-05:** every request logs express-rate-limit `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`
  (`trust proxy` is not set). The rate limiter likely keys on App Runner's proxy address, so all users share one
  bucket. Set `app.set('trust proxy', 1)` after confirming the hop count.
- My Tokens names a token "Token 7C9960DF" (first 8 of the tag id) when it has no title; show the chip name or serial
  suffix instead.
- Admin Tags cannot be searched by owner email; the owner shows as a random account id (Boss, 2026-10-19). Plan:
  one search box (owner email, chip name, serial / UID suffix), owner and creator email columns, `manage_nfc` only,
  emails never logged.

## Setup steps (done; kept for production)

**Boss, in order (DB → backend → frontend):**

1. **Apply the migration** from the worktree, then re-run the live checks against the applied functions:
   ```bash
   cd ~/devProjects/Dev/dev/projectClaude/unmentionables/Unmen/.claude/worktrees/s-admin1-ph3
   supabase db push --linked
   supabase db query --linked -f supabase/tests/s_admin1_ph3a_live.sql   # expect RESULTS {...} all "ok"
   ```
2. **Sweep secret.** Generate one value and put it in both places:
   ```bash
   SECRET="$(openssl rand -base64 36)"; echo "$SECRET"
   ```
   - App Runner env `TOKEN_FEE_SWEEP_SECRET` = that literal.
   - Supabase SQL editor:
     ```sql
     SELECT vault.create_secret('https://vw7zy9mkyg.us-east-2.awsapprunner.com', 'backend_api_url');
     SELECT vault.create_secret('<the same secret>', 'token_fee_sweep_secret');
     ```
   - Paste it as one line. A leading space or newline makes App Runner's proxy answer `400 Bad Request` to every
     tick. Check with `SELECT length(decrypted_secret), length(btrim(decrypted_secret, E' \t\r\n')) FROM
     vault.decrypted_secrets WHERE name = 'token_fee_sweep_secret';` (the two must match). To replace it:
     `SELECT vault.update_secret((SELECT id FROM vault.secrets WHERE name = 'token_fee_sweep_secret'), '<secret>');`
3. **GitHub token.** Fine-grained personal access token, repository `suprMan21/auctionX` only, permission
   **Issues: Read and write**. Store in 1Password, then App Runner env `GITHUB_ISSUES_TOKEN` = the literal.
   Optional: create the label `stuck-payment` on the repo (GitHub creates it on first use otherwise).
4. Merge `feature/s-admin1-ph3` into `dev`, push, run `scripts/verify-backend-deploy.sh`.
5. Deploy the frontend (`scripts/deploy-frontend.sh staging`).

**Claude, after step 1:** regenerate both `database.types.ts` copies and remove the `payment_incidents` entry from
`PENDING_MIGRATION_COLUMNS` in `schemaColumnDrift.test.ts`.

**Live test plan (no chip needed; sandbox card only).** Note: a missed webhook that the sweep can apply is recorded
already closed, so it shows under **Applied**, not under the default **Open** filter. "Check now" within 5 minutes of
the payment finds nothing (grace window).
1. *Missed webhook.* In the Stripe sandbox dashboard, disable the token-fee webhook endpoint. Start a transfer of
   `chip_004` (test2@ → test@) and pay. Wait 5 minutes, open Stuck payments, press Check now. Expect: transfer
   completed, one incident shown under Applied ("Applied by the automatic check"), one GitHub Issue. Re-enable the
   endpoint.
2. *Refund.* With the endpoint disabled again: start a transfer, pay, then cancel the transfer before the sweep
   runs. Check now → an Open `not_payable` incident. Refund it as super_admin. Expect: refund visible in Stripe,
   incident under Refunded, a comment on its GitHub Issue. Re-enable the endpoint.
3. *Cron.* Leave one paid-and-unapplied payment alone for 15 minutes; confirm the tick applied it
   (`claude-ro` logs: `token_fee_sweep_done`).
4. Read every result back from the system (logs, `payment_incidents`, `audit_logs`), not from the screen.

**Never retire `chip_001`.** Transfers in the test plan end with `chip_004` back at test2@ or noted here.

## Known limits

- **Shared sandbox noise.** A local dev backend that uses the same Stripe sandbox as staging creates
  PaymentIntents that name rows staging does not have. The staging sweep will record those as `row_missing` and
  open an Issue for each. Harmless, but do not refund them from the staging console.
- **Refund race.** Refund checks the incident is OPEN, refunds in Stripe, then records. If a Stripe retry applies
  the payment in the instant between, the money is refunded for a transfer that completed. The recording step
  then fails with "already resolved" and logs `admin_payment_refund_record_failed` with both ids. Narrow window;
  noted for S-SEC1.
- **Issue volume.** An ignored open incident gets one comment every 6 hours until it is closed.
- Sweep window is 72 hours and 1,000 PaymentIntents per run (`truncated` is reported if exceeded).
- Approved-but-unpaid re-issue requests still do not expire (carried from Ph2).
- A partial refund made by hand in Stripe is treated as refunded by the sweep.

## Config reference

| Env (App Runner, literals) | Purpose | Default |
|---|---|---|
| `TOKEN_FEE_SWEEP_SECRET` | Shared secret for the cron tick (min 24 chars) | unset = endpoint answers 503 |
| `GITHUB_ISSUES_TOKEN` | Fine-grained token, Issues read/write | unset = no issues filed |
| `GITHUB_ISSUES_REPO` | `owner/name` | `suprMan21/auctionX` |
| `TOKEN_FEE_SWEEP_LOOKBACK_HOURS` | How far back the sweep looks | 72 |
| `TOKEN_FEE_STUCK_AFTER_MINUTES` | Grace before a paid fee counts as stuck | 5 |
