# S-2FA Ph4 — rollout: verification

**Branch:** `feature/s-2fa-ph4` (worktree `.claude/worktrees/s-2fa-ph4`). **Date:** 2026-10-28.
Plan: `docs/plans/2026-10-27-s-2fa.md` (Ph4 row). Ships with every flag still off; the flags are turned on
in staging during the rollout below.

## Boss decisions (2026-10-28)

| Question | Decision |
|---|---|
| A collector who already has a method: asked at every sign-in? | **Yes.** (Already how LoginPage works: any account with a method gets the second step.) |
| First method is trusted on sight | **Email on the first method** (it was already sent; the copy now points to Recover by email). No email-link confirmation. |
| Which keys may the break-glass account use? | **Any genuine YubiKey**, not one exact model. |

Already Locked 2026-10-27: Creators set up at their next sign-in; collectors at their first claim, transfer
or release (Decisions DB "S-2FA Ph4: Creators must set up two-step sign-in at their next login").

## What changed

| Area | Change | Files |
|---|---|---|
| Who must use 2FA, and when | `twoFactorPolicy(userId)`: **at sign-in** = staff (`FEATURE_REQUIRE_ADMIN_2FA`) or Creator (`FEATURE_REQUIRE_CREATOR_2FA`, new); **for token actions** = everyone (`FEATURE_REQUIRE_2FA`) or the above. `enrolmentRequired` follows "at sign-in" only, so turning on `FEATURE_REQUIRE_2FA` no longer sends collectors to setup at sign-in (it would have before this branch). Both gates (`requireSecondFactor`, `passesTwoFactor`) use it and fail closed on a lookup error. | `lib/mfa/policy.ts`, `middleware/mfaGates.ts`, `lib/security/twoFactorGate.ts`, `controllers/mfaController.ts`, `lib/mfa/store.ts` (`accountType`) |
| Break-glass key must be a YubiKey | super_admin registration asks for **direct attestation**; `checkHardwareKeyAttestation` requires a `packed` certificate chain ending at one of Yubico's three FIDO roots (pinned; fingerprints in the file and in a test), every certificate in date, intermediates are CAs, model ID not all zeros. Self attestation / `none` → `hardware_key_required`. Everyone else unchanged (`attestation: none`). | `lib/mfa/hardwareKeyAttestation.ts`, `lib/mfa/mfaService.ts` |
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

- Backend: tsc 0; vitest **1102 passed / 23 skipped** (new: policy status cases, creator gate + fail-closed,
  first-method email for passkey and TOTP, break-glass attestation via a soft authenticator with a test CA,
  13 chain-check unit tests incl. the pinned Yubico fingerprints). One run of the full suite had a single
  failure that did not repeat in 5 full runs + 15 runs of the touched files (pre-existing timing flake; not
  identified).
- Frontend: tsc 0; vitest **390 passed** (new: `SecondFactorNeeded`, recovery without ticking the box).
- Fixtures: `backend/src/__tests__/fixtures/attestation/` (test-only CA + keys, protect nothing).

## Security review

Independent agent, 2026-10-28: **no High**. Verified safe: every gate path fails closed (null user, sub mismatch,
lookup error → 403 / 503); `account_type` cannot be written by users (column grant, trigger only); admin console
consistent; a forged root with Yubico's subject fails fingerprint + signature; refusal cannot be skipped; no
open redirect from the new links.

| Finding | Severity | Outcome |
|---|---|---|
| Passkeys added before Ph4 (or while not super_admin) still sign in to the break-glass account | Medium | **Fixed**: `user_passkeys.attested_vendor` (migration `20261028000001`); break-glass sign-in and step-up use only `yubico` passkeys; tests |
| First-method email advises Recover by email, but the thief's method can cancel that recovery | Medium | **Fixed** (Boss 2026-10-28): only a method added at least 7 days before the recovery started can cancel or undo it |
| Creator setup at sign-in is enforced by the browser only; the server still refuses every token action | Low | Accepted: token actions are what matter, and they are server-gated |
| Yubico's newest root also issues PIV certificates | Low | **Fixed**: leaf must carry the FIDO model-ID extension and not be a CA; test with a PIV-style chain |
| Older `fido-u2f` keys refused | Low | Accepted, documented in the module (every YubiKey 5 / Security Key uses `packed`) |
| No path-length / key-usage checks | Low | Accepted (pinned roots) |

## Rollout on staging (Boss)

**0. Deploy.** Claude merges into `dev`; Boss runs `supabase db push --linked` (migration `20261028000001`, adds `user_passkeys.attested_vendor`), pushes `dev`; `scripts/verify-backend-deploy.sh`; then
`scripts/deploy-frontend.sh staging`. App Runner env: 2 free slots. `FEATURE_REQUIRE_CREATOR_2FA` and
`FEATURE_ADMIN_TWO_PERSON` each need one. Free more first by deleting vars equal to their defaults
(`WEBAUTHN_ORIGINS`, `WEBAUTHN_RP_NAME`, `MFA_SESSION_TTL_HOURS`; see `docs/TODO.md`). Keep the
`FEATURE_REQUIRE_*` vars: step 3 flips them to `true`.

**1. Re-register the break-glass YubiKeys.** After the deploy (and migration `20261028000001`), the
break-glass account only accepts passkeys whose attestation was checked at registration, so both current keys
(blank model ID) **stop working** for it. Backup codes still work. In **desktop Chrome** (Safari may not share
the key's details), as `chris.lafleche@cravingcorp.com`:
1. Sign in with password + a **backup code**.
2. Security → remove **breakGlassKey2** (confirm with a backup code).
3. Add a passkey with key 2 (name it `breakGlassKey2`; confirm with a backup code). If Chrome asks whether
   the site may see your security key's make and model, choose **Allow**.
4. Remove **breakGlassKey 1**, then add key 1 the same way (backup codes again: a key added with a code
   waits 24 h before it can approve changes).
5. Claude reads `user_passkeys.aaguid` + `attested_vendor` for the account: both rows non-zero / `yubico`.
   If a key is refused ("could not be confirmed as a YubiKey"), the backend log `break_glass_key_refused` says why.
6. After 24 h: Security → new backup codes (confirm with a key), and store them as before.

About 5 of the 10 backup codes get used. (The same physical key cannot be added twice, which is why each is
removed first.)

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
