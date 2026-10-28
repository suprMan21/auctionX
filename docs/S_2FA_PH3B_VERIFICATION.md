# S-2FA Ph3b verification: email-code recovery, backup email, security mail on SES

**Date:** 2026-10-27 · **Branch:** `feature/s-2fa-ph3b` · **Plan:** `docs/plans/2026-10-27-s-2fa-ph3b.md` ·
**Covers:** S-2FAb AC7, AC13, AC14 (SES instead of a Postmark security server)

## Boss decisions (2026-10-27)

| Topic | Decision |
|---|---|
| Security mail | **Amazon SES** (stores no message body). Postmark keeps every other mail. Codes never go through Postmark |
| Staff | No email recovery and no backup email for super_admin, admin or support |
| Finish | Fresh code after the 72 h hold; then one new passkey or authenticator app (30 min), new backup codes |
| Old methods | Kept; old backup codes voided at finish; **Undo** with an old method during the 7-day freeze |
| Freeze | Transfer start + accept, release, re-issue request, sign-in method changes, backup codes, backup email, password / email change |

## What shipped

| Area | Detail |
|---|---|
| Flow | `/sign-in/recover` (link on the sign-in step, hidden for staff): choose account or backup email → code → 72 h hold, every address told → after the hold a fresh code → finish (optional new password: one `password` permit, since the Ph2b lock and the freeze would refuse it otherwise) → add one method → done |
| Codes | 6 digits, 10 min, single use, 5 attempts (counted before the compare, under a row lock), new send voids the old one; 60 s / 3 per hour / 10 per day per account (advisory lock) + the per-IP code budget; HMAC (HKDF of `MFA_RECOVERY_PEPPER`, label `am/email-code-v1`) over purpose \| id \| user \| session \| code; bound to Supabase `session_id` + `X-Recovery-Nonce` (sha256 stored); never logged; body only, never the subject |
| Freeze | `refuseWhileFrozen` on release, transfer initiate, transfer complete, re-issue request (before any step-up); `refuseIfFrozen` in the MFA service and at step-up options / verify for frozen actions (before a code is spent) |
| Undo | Step-up `recovery_undo` bound to the recovery id, passkey or authenticator app the account had before (recovery-added ones refused, and left out of the passkey prompt); removes what the recovery added, ends other sessions, new backup codes |
| Backup email | Security settings card: add / replace (step-up `recovery_channel`, code to the new address), confirm, remove; must differ from the account email; masked everywhere; both addresses told |
| Mail | `lib/notifications/securityMailSender.ts`: SES v2 `SendEmail`, no configuration set (no tracking), `SECURITY_MAIL_FROM`; codes refuse with 503 `mail_unavailable` when SES is not configured; the existing security notices use SES when configured, else Postmark |
| DB | Migration `20261027000013`: `user_backup_emails`, `email_codes`, `account_recoveries` (RLS, service_role only), `added_by_recovery` on passkeys + TOTP, CHECK supersets (`email_recovery`, `recovery_undo`, `recovery_channel`), 8 functions (definer, `public, pg_temp`, EXECUTE revoked), `account_delete_blockers` exclusion list + these tables and `auth_change_permits`, mfa-cleanup clears old codes |

## Tests

- Backend vitest **1071 passed / 23 skipped** (new `mfaRecovery.test.ts` 33). One run saw `mfa.test.ts › refuses a grant … after 2 minutes` fail once under load; passed on 3 re-runs (timing, unrelated).
- Frontend vitest **386 passed** (new `recovery.test.tsx` 12; security folder 36). tsc 0 both, eslint clean.
- Live SQL `supabase/tests/s_2fa_ph3b_live.sql` **27/27** (dry run with the migration, rolled back; staging left clean).
- `schemaColumnDrift.test.ts`: the new tables/columns are listed in `PENDING_MIGRATION_COLUMNS` until the migration is applied and types regenerated (remove them then).

## Rollout (done 2026-10-27 / 28)

| Step | Result |
|---|---|
| Migration `…13` | Applied by Boss; live SQL 27/27; both `database.types.ts` regenerated, `PENDING_MIGRATION_COLUMNS` emptied (`24d2476`) |
| SES us-east-2 | Domain `authentic-materials.com` verified (Easy DKIM via Route 53). Still in the sandbox: production access to request before real users |
| Sender | App Runner `SECURITY_MAIL_FROM` = `Authentic Materials <noreply@authentic-materials.com>` |
| IAM | Inline policy `SesSecurityMail` (`ses:SendEmail` on `arn:aws:ses:us-east-2:904183418667:identity/*`) on the role `am-backend-staging-instance`, which the backend actually uses (App Runner's `AWS_ACCESS_KEY_ID` has no secret, so the SDK ignores it; the S3 code also falls back). Scoping to `identity/authentic-materials.com` alone gave AccessDenied: in the sandbox SES also checks the recipient identity. It was also added to the user `auctionx-s3-access` while debugging: not needed, remove it (that key is the local-dev key). Tighten to the domain identity after production access |
| Deploys | Backend `99dfb6d` (23:54 EDT), staging frontend 22:41 EDT |
| Added during rollout (Boss) | A sign-in with a passkey, authenticator code or backup code deletes the account's emailed codes (send limits back to 0, live codes void); waiting recovery / freeze / post-undo block untouched. `security_mail_failed` now logs AWS's reason with addresses stripped |

## Staging click-through (2026-10-28, Boss; checked against DB + logs)

| Check | Result |
|---|---|
| Code email via SES from `noreply@` | ✅ |
| Start → 72 h hold → red notice on the owner's browser → Cancel | ✅ (test@, cancelled 03:45Z) |
| Start → hold skipped by SQL → fresh code → finish → one method added → 7-day freeze | ✅ (test@, 04:00–04:01Z, freeze to 4 Nov) |
| Undo with the old passkey: added method removed, new backup codes, other sessions ended | ✅ (04:02:46Z) |
| Sign-in resets code counters | ✅ (test2@: code 04:10:16Z → passkey sign-in 04:10:35Z → 0 rows) |
| Backup email add + confirm | ✅ (test2@, confirmed, nothing pending) |
| Finding | The optional new-password box was filled (likely browser autofill), so test@'s password changed at finish (permit used 04:01:12Z). Update 1Password. Consider a "Set a new password" checkbox instead of a bare field (Ph4 copy pass) |

## Security review (2026-10-27, before merge)

No High, no way around the 72 h hold found. Held: code binding (HMAC over purpose|id|user|session|code, row lock,
attempt counted first, junk costs an attempt, wrong session / nonce costs none), enrolment claim races, undo method
rules, SQL (definer, `public, pg_temp`, grants, CHECK supersets, `account_delete_blockers` differs only in the
exclusion list), no code / nonce / full address in logs, events or responses.

| Finding | Severity | Status |
|---|---|---|
| **M1** Undo ended other sessions after the undo committed; a failure left the attacker a verified session with no freeze | Medium | **Fixed**: `undo_account_recovery(user, id, keep_session)` calls `mfa_end_other_sessions` in the same transaction |
| **M2** A passkey enrolment racing an undo could land after it | Medium | **Fixed**: trigger `guard_recovery_method` on passkeys + TOTP: a method tagged `added_by_recovery` saves only while that recovery is completed and frozen (`FOR SHARE` waits for a running undo) |
| L1 The recovery add signed out the owner's sessions; a new recovery could start right after an undo | Low | **Fixed**: the recovery add ends no sessions; no new recovery for 7 days after an undo |
| L2 A refused backup-email add (send limit, SES) still replaced a confirmed address; a stale undo id burned the step-up | Low | **Fixed**: code sent first; a confirmed address stays until the replacement is confirmed (`pending_email`); undo pre-check |
| L3 Re-issue photo / pay / cancel, transfer cancel and disclosure were not frozen | Low | **Fixed**: `refuseWhileFrozen` on all five |
| L4 Staff exclusion only at recovery time; admin gate accepted an `email_recovery` marker | Low | **Fixed**: trigger `guard_staff_recovery` on `admin_users`; admin gate ignores `email_recovery` markers |
| Send limits are per account across purposes, so someone with the password can spend the owner's daily codes | Info | Accepted (the owner's methods still work; limits reset daily) |

## Open

| Item | Where |
|---|---|
| Admin console: "Reset code limits" + recovery status on the account page (Boss) | Feature Backlog |
| SES production access request; then tighten `SesSecurityMail` | Boss |
| Move the backend off the `auctionx-s3-access` env key onto its instance role (after an S3 permission audit) | Ph4 |
| Reminder email 24 h before a hold ends | Later (needs a cron tick) |
| City in the code email (only browser + OS today) | Later (needs IP geolocation) |
| Granting a staff role to an account with a waiting / frozen recovery fails in the database (`recovery_in_progress`); the console shows a generic error | Map the error, S-ADMIN2 follow-up |
| `/reset-password` for an account with a second factor still hits the Ph2b lock: the person must use Recover by email (or sign in with a method first) | Copy on the reset page, Ph4 |
| Recovery after an email change: a recovery started on the old address keeps that channel; finishing needs it to still be on the account | By design (refuses with `recovery_not_available`) |
