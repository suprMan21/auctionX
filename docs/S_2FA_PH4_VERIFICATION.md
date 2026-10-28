# S-2FA Ph4 — rollout: verification

**Branch:** `feature/s-2fa-ph4` (worktree `.claude/worktrees/s-2fa-ph4`), merged to `dev` and pushed. **Date:** 2026-10-28.

**Status (2026-10-28, 02:15 EDT):** backend deploy SUCCEEDED 02:01, staging frontend has the Ph4 screens, migration
`20261028000001` applied, **all five flags on** (Boss). Break-glass verified from the records: passkey sign-in
02:09, `breakGlassKey2` used 02:11, `Yubikey1` added, backup codes regenerated (all `ok` in the logs).
**Phone click-through: not yet.**
Plan: `docs/plans/2026-10-27-s-2fa.md` (Ph4 row). Ships with every flag still off; the flags are turned on
in staging during the rollout below.

## Boss decisions (2026-10-28)

| Question | Decision |
|---|---|
| A collector who already has a method: asked at every sign-in? | **Yes.** (Already how LoginPage works: any account with a method gets the second step.) |
| First method is trusted on sight | **Email on the first method** (it was already sent; the copy now points to Recover by email). No email-link confirmation. |
| Which keys may the break-glass account use? | First: any genuine YubiKey (attestation check). **Reversed the same day:** Boss can't tell whether his keys are YubiKeys, so the check was removed. The break-glass account accepts any hardware security key that is not a synced passkey (the key's own backup flags), as before Ph4. |

Already Locked 2026-10-27: Creators set up at their next sign-in; collectors at their first claim, transfer
or release (Decisions DB "S-2FA Ph4: Creators must set up two-step sign-in at their next login").

## What changed

| Area | Change | Files |
|---|---|---|
| Who must use 2FA, and when | `twoFactorPolicy(userId)`: **at sign-in** = staff (`FEATURE_REQUIRE_ADMIN_2FA`) or Creator (`FEATURE_REQUIRE_CREATOR_2FA`, new); **for token actions** = everyone (`FEATURE_REQUIRE_2FA`) or the above. `enrolmentRequired` follows "at sign-in" only, so turning on `FEATURE_REQUIRE_2FA` no longer sends collectors to setup at sign-in (it would have before this branch). Both gates (`requireSecondFactor`, `passesTwoFactor`) use it and fail closed on a lookup error. | `lib/mfa/policy.ts`, `middleware/mfaGates.ts`, `lib/security/twoFactorGate.ts`, `controllers/mfaController.ts`, `lib/mfa/store.ts` (`accountType`) |
| Break-glass key | YubiKey-only attestation check built, then **removed** (Boss 2026-10-28). Column `user_passkeys.attested_vendor` (migration `20261028000001`, already on staging) stays but is unused (schema rules: no column removal). |
| First-method email | Same subject; for the first method the body says the account now asks for it, and "if this wasn't you, someone knows your password: Recover by email (72 hours)" (the owner cannot "sign in and remove it"). | `lib/mfa/mfaEmails.ts` |
| Token screens | On `2fa_required` (claim, release, transfer start / accept / cancel): a link **Set up two-step sign-in** (`/settings/security/setup?next=here`) when the account has no method, else **Confirm it's you** (`/sign-in/verify?next=here`). | `security/components/SecondFactorNeeded.tsx`, 5 token components, `tokens/lib/copy.ts` |
| Recover by email | "Set a new password too" checkbox; the password box only appears when ticked (Ph3b: autofill changed test@'s password). | `security/pages/RecoveryPage.tsx` |
| Reset password | Link to Recover by email for people who lost their method too (the Ph2b lock otherwise stops them). | `auth/pages/ResetPasswordPage.tsx` |

Not changed: mobile (Flutter) calls only `/nfc/scan`, `/nfc/register`, `/nfc/tags`, `/nfc/proof` and the removed
mint route, none of them gated.

## Recovery: the 7-day rule (Boss, 2026-10-28)

A method added **less than 7 days before** a recovery started cannot **cancel** it (the account must hold an
older passkey or authenticator app; the session marker does not record which method passed) and cannot
**undo** it (checked against the exact passkey or app used). Case it stops: someone with only the password
adds the first method, then cancels or undoes the owner's email recovery forever. Trade-off: a brand-new
account (all methods < 7 days) cannot cancel a recovery started by someone who has both the password and the
email inbox; email is the root of trust in a method's first week. The recovery-started email and page say so.
`lib/mfa/recoveryState.ts` (`methodPredatesRecovery`), `recoveryService.cancelRecovery`, `mfaService` undo step-up.

## Tests

- Backend: tsc 0; vitest **1080 passed / 23 skipped** (new: policy status cases, creator gate + fail-closed,
  first-method email for passkey and TOTP, 7-day recovery rule). One run of the full suite had a single
  failure that did not repeat in 5 full runs + 15 runs of the touched files (pre-existing timing flake; not
  identified).
- Frontend: tsc 0; vitest **390 passed** (new: `SecondFactorNeeded`, recovery without ticking the box).

## Security review

Independent agent, 2026-10-28: **no High**. Verified safe: every gate path fails closed (null user, sub mismatch,
lookup error → 403 / 503); `account_type` cannot be written by users (column grant, trigger only); admin console
consistent; no open redirect from the new links.

| Finding | Severity | Outcome |
|---|---|---|
| Passkeys added before Ph4 (or while not super_admin) still sign in to the break-glass account | Medium | Fixed, then **moot**: the YubiKey check was removed (Boss) |
| First-method email advises Recover by email, but the thief's method can cancel that recovery | Medium | **Fixed** (Boss 2026-10-28): only a method added at least 7 days before the recovery started can cancel or undo it |
| Creator setup at sign-in is enforced by the browser only; the server still refuses every token action | Low | Accepted: token actions are what matter, and they are server-gated |
| Yubico's newest root also issues PIV certificates | Low | Moot (check removed) |

## Rollout on staging (Boss)

**0. Deploy.** Claude merges into `dev`; Boss pushes `dev` (migration `20261028000001` already applied); `scripts/verify-backend-deploy.sh`; then
`scripts/deploy-frontend.sh staging`. App Runner env: 2 free slots. `FEATURE_REQUIRE_CREATOR_2FA` and
`FEATURE_ADMIN_TWO_PERSON` each need one. Free more first by deleting vars equal to their defaults
(`WEBAUTHN_ORIGINS`, `WEBAUTHN_RP_NAME`, `MFA_SESSION_TTL_HOURS`; see `docs/TODO.md`). Keep the
`FEATURE_REQUIRE_*` vars: step 3 flips them to `true`.

**1. Break-glass keys:** nothing to do. The current two keys keep working.

**2. Phones** (plan "Manual" list): passkey on iPhone Safari and Android Chrome; sign out / in with each;
authenticator app; a backup code (check the email); release a spare token (**never `chip_001`**); transfer
test@ → test2@; a price change; Ph3a: admin@ suspends test2@ → admin2@ approves.

**3. Flags, one at a time** (each is an App Runner change + redeploy; check after each):

| # | Flag | Check after |
|---|---|---|
| a | `FEATURE_REQUIRE_2FA=true` | A collector with no method signs in normally; claiming shows "Set up two-step sign-in" |
| b | `FEATURE_REQUIRE_ADMIN_2FA=true` | admin@ / admin2@ get the second step on the console |
| c | `FEATURE_REQUIRE_CREATOR_2FA=true` (new var) | A Creator with no method is sent to setup right after the password |
| d | `FEATURE_REQUIRE_STEP_UP=true` | Release / accept / price change ask "Confirm it's you" |
| e | `FEATURE_ADMIN_TWO_PERSON=true` (new var) | admin@ token reset goes to `/admin/approvals`; admin@ cannot approve it |

Rollback for any step: set the flag back to `false` (or delete it) and redeploy.

## Open

| Item | Where |
|---|---|
| super_admin TOTP is refused already; recovery for staff is refused (Ph3b) | none |
| KMS for TOTP secrets; cross-environment origin test | S-2FAb remaining |
| Admin "Reset code limits" + recovery status | Feature Backlog |
