# S-2FA Ph3a verification: two-admin approval, owner token emails, tidy-ups

**Date:** 2026-10-27 · **Branch:** `feature/s-2fa-ph3a` · **Flag:** `FEATURE_ADMIN_TWO_PERSON` (default off)

Ph3 was split (Boss 2026-10-27): **Ph3a** = this doc. **Ph3b** = email-code recovery (72 h hold, 7-day freeze,
backup email) + Postmark security server, with its own security review.

## What shipped

| Area | Detail |
|---|---|
| Rule | Daily admins (admin@, admin2@) approve each other's **token reset, token suspend, account suspend, account retire**. super_admin acts alone (break-glass) via new permission `act_without_approval` (a permission, not a role-name check). Undo actions (unsuspend, reactivate) never wait |
| Retire added | The plan assumed retire was super_admin-only; it is `manage_users` (admins can retire), so it is gated too. Drop it from `APPROVAL_ACTIONS` + the SQL CHECK if Boss disagrees |
| Migrations | `20261027000011` (enum value; **applied to staging 2026-10-27**), `20261027000012` (table `admin_action_approvals` + `admin_request_approval`, `admin_decide_approval`, `admin_record_approval_result`, `admin_expire_approvals`; service_role only; **dry run on staging 20/20, rolled back**, not yet applied) |
| DB rules | Audit row (`approval_request` / `approval_approve` / `approval_reject` / `approval_cancel`, entity `admin_approval`) in the same transaction; not your own request (function + CHECK); one open request per action + target; 24 h expiry (expired never blocks a new request); approve refused if the requester lost access; account action never runs on the approver's own account |
| API | Gated routes return `202 { approvalRequired, approvalId, expiresAt }`. `GET /admin/approvals?status=waiting_for_me\|open\|closed\|all&id=`; `POST …/:id/approve` (**always** a passkey step-up `admin_approve` bound to the id; body must be `{}`), `…/reject { reason }`, `…/cancel` (requester). Approve runs the **stored** payload (sha256 of canonical JSON checked) as the approver through the same code as a direct action; outcome recorded on the request. `GET /admin/me` → `approvalRequired` |
| Console | Approvals under Queues (badge), Needs attention card, `?request=<id>` deep link; dialogs say **Send for approval** and end on "Sent for approval"; audit rows link to the request |
| Owner emails | Release → owner. Completed transfer (card webhook, voucher, sweep, Re-apply: the two choke points in `tokenFeeApply.ts`) → old owner "has moved to its new owner", new owner "is now in your account". Never names the other party; fire and forget |
| Tidy-ups | `WEBAUTHN_ORIGINS` optional (defaults to `https://<WEBAUTHN_RP_ID>`) + cross-environment origin test (S-2FAb AC8); dead NFT mint deleted (`nftMinting.ts`, `pinataService.ts`, `/nfc/mint`, `mintSchema`); test proves `/nfc/mint` 404s even with the marketplace on |
| Home page | "Look for it. Tap it. Keep it." → **"Every seal tells a story."** (steps: The story starts at the source / One tap tells it / The story goes with it). Separate commit; public deploy is Boss's |

## Tests

- Backend vitest **1029 passed / 23 skipped** (new: `adminApprovals.test.ts` 30, `tokenActivityEmails.test.ts` 4, `mfaConfig.test.ts` 4). One run saw `adminStats › unknown series` fail once under load; passed on 3 re-runs (flaky, unrelated).
- Frontend vitest **363 passed** (new `adminApprovals.test.tsx` 14). tsc 0 both.
- Live SQL `supabase/tests/s_2fa_ph3a_approvals_live.sql` **20/20** (dry run with migration 12, rolled back; staging left clean).

## Rollout (Boss)

1. Push `dev` → confirm App Runner deploy (`scripts/verify-backend-deploy.sh`); `supabase db push --linked` applies `…12` (`…11` already there, idempotent); re-run the live SQL → 20/20.
2. `scripts/deploy-frontend.sh staging`; `scripts/deploy-frontend.sh public` for the home page copy.
3. App Runner env: you may **delete `WEBAUTHN_ORIGINS`** if it equals `https://d1bwev65w7rqzl.cloudfront.net` (frees a slot). Do not add `FEATURE_ADMIN_TWO_PERSON` yet (Ph4).
4. Ph4 click-through: admin@ suspends test2@ → 202 → admin2@ approves with passkey → suspended; admin@ cannot approve its own.

## Open

| Item | Where |
|---|---|
| Re-issue **fulfil** and stuck-fee **Move to new chip** also swap chips without a second admin (owner-requested, paid, admin-approved already) | Boss decision (see review) |
| Why App Runner has `AWS_ACCESS_KEY_ID` (should be the instance role); confirm NFT env vars gone (`claude-ro` cannot DescribeService) | Boss, console |
| Postmark cannot keep zero content: minimum 7 days, account-wide ("Message content cannot be hidden or deleted immediately"). Options: separate Postmark account for security mail at 7 d, or Amazon SES for security mail (no stored bodies) | Ph3b, Boss decision |
| Email recovery, backup email, security server | Ph3b |

## Security review (2026-10-27, before merge)

No High. Held: not-your-own (function + CHECK + id compare, so a second session of the same admin cannot approve),
FOR UPDATE serialises decisions, requester + approver permission re-checked, support refused, approve step-up
passkey only and bound to user + session + action + id, payload runs as stored, no raw DB text, grants locked.

| Finding | Severity | Status |
|---|---|---|
| **M1** A daily admin can still swap chips alone via re-issue: approve with fee waived, then fulfil (also the stuck-fee "Move to new chip" shortcut) | Medium | **Boss decision** (recommend: gate fulfil when the same admin approved the re-issue, or always) |
| **M2** Unsuspend / reactivate are not gated, so one admin can lift a hold the other (or super_admin) set | Medium | **Boss decision** (recommend: gate lifting a hold set by someone else) |
| L1 `search_path` without `pg_temp` | Low | Fixed (`public, pg_temp`; live SQL re-run 20/20) |
| L2 Payload hash is integrity-only, not tamper-proof (table is service_role only) | Low | Documented in code |
| L3 The action's own audit row names the approver only; the link to the request is the `approval_approve` row | Low | Accepted (join on time + target); revisit with S-OPS |
| L4 `invalid_action` / `invalid_argument` became unlogged 500s | Low | Fixed (mapped; internal decide errors logged) |
| L5 Request-squatting: one admin can file open requests on many targets for 24 h | Low | Accepted (super_admin unaffected; reject clears it) |
| L6 Transfer emails read `public.users.email` (users cannot change it, but it can drift from the auth email) | Low | Accepted for now; move to the confirmed auth email with Ph3b's mail work |
