# S-2FA Ph2 — Verification (screens + small hardening)

**Date:** 2026-10-27 · **Branch:** `feature/s-2fa-ph2` · **Plan:** `docs/plans/2026-10-27-s-2fa.md`
**Status:** Code done, tests green, migration dry-run 9/9 on staging. All flags still off: with
`FEATURE_REQUIRE_2FA` / `FEATURE_REQUIRE_ADMIN_2FA` / `FEATURE_REQUIRE_STEP_UP` false, the new screens are
reachable (Settings → Security) but nothing is required and no existing flow changes.

## Boss decisions (2026-10-27, this session)

1. **Email-code account recovery moves to Ph3** (with two-admin approval). Ph2 ships passkey / authenticator app /
   backup codes only. The sign-in second step says we can't switch two-step sign-in off for someone.
2. **Step-up for release and transfer complete: passkey or authenticator code. Staff accounts: passkey only.**
   Backup codes never confirm a token action. This replaces the passkey-only release rule (2026-10-03) for
   non-staff accounts. Admin actions (price change, approvals) stay passkey only.
3. **Fold the small S-2FAb gaps into Ph2:** end other sessions on any sign-in method change, per-IP limit on code
   checks, staff factor events in `audit_logs`. KMS for TOTP and the cross-environment origin test stay for later.

## What shipped

| Piece | Where |
|---|---|
| Security settings: passkeys (add, rename, remove), authenticator app (QR + typed key), backup codes (count, make new set) | `frontend/src/features/security/pages/SecurityPage.tsx` (`/settings/security`, linked from the user menu) |
| Sign-in second step: passkey first, then authenticator code or backup code; shows the code lockout time | `pages/SecondFactorPage.tsx` (`/sign-in/verify?next=`) |
| Required setup (only when the server requires it and the account has no method) | `pages/EnrolRequiredPage.tsx` (`/settings/security/setup`) |
| "Confirm it's you" panel, inline in Release, Accept transfer and the two price dialogs; standalone dialog for Settings | `components/StepUpPanel.tsx`, `StepUpDialog.tsx` |
| Backup codes shown once: copy, download, "I saved them" before Done | `components/BackupCodesPanel.tsx` |
| Route guard: required + no method → setup; required + not confirmed → second step. If the status can't load the page renders (the server is the boundary) | `components/SecondFactorGate.tsx` in `ProtectedRoute` |
| Sign-in: an account with a method goes to the second step after the password (even with the flag off) | `features/auth/pages/LoginPage.tsx` |
| Admin console: `ADMIN_2FA_REQUIRED` opens the second step and comes back; no longer signs out | `features/admin/components/AdminProtectedRoute.tsx` |
| Try first, confirm only when asked: screens send the action as normal and show the panel only on `step_up_required`, then resend with `X-Step-Up`. A step-up or second-factor refusal on Accept transfer keeps the tap session (both gates refuse before the handler spends it) | `ReleaseTokenDialog.tsx`, `TransferCompleteFlow.tsx`, `AdminPricingDialogs.tsx` |
| Code step-up for release / transfer complete (non-staff); `passkey_required` (staff) and `backup_code_not_allowed`; refused before the code is checked, so it is never spent or counted | `backend/src/lib/mfa/mfaService.ts` |
| Status adds `isStaff`, `secondFactorRequired` | `mfaService.getStatus` |
| `mfa_end_other_sessions(user, keep_session)`: after passkey add, authenticator confirm, new backup codes, passkey or authenticator removal. Keeps the caller's session; raises on a NULL keep session. Responses carry `otherSessionsEnded` | migration `20261027000008_s_2fa_ph2.sql` |
| Per-IP limit 30/min (`MFA_IP_LIMIT_PER_MIN`) on the 7 code-check routes, before `requireAuth` | `backend/src/routes/mfa.ts` |
| Staff factor add / remove / regen / lockout → `audit_logs` (`entity_type 'user'`, `changes = {method}` only); written after the change, never blocks | `mfaService.auditIfStaff`, `store.writeStaffAudit` |
| Wording: passkey, Face ID or fingerprint, security key, authenticator app, backup codes. Never "AAL", "WebAuthn", "MFA" | `features/security/lib/copy.ts` |
| Library | `@simplewebauthn/browser` **14.0.0** (pinned exact; released 2026-09-02, matches server 14.0.3) |

**Decisions made in the build (for Boss to know):**
- A **first** method also ends other sessions: harmless, and signs out anyone who got in with just the password.
- If ending other sessions fails, the change still succeeds (`otherSessionsEnded: false` + `mfa_end_other_sessions_failed` error log).
- The function does **not** bump `admin_users.session_version` (that would end the caller's own admin token); deleting
  the sessions is enough because `requireAuth` and `verifyAdminAuth` both ask GoTrue.

## Tests

| Suite | Result |
|---|---|
| Backend `tsc --noEmit` | 0 errors |
| Backend vitest | **961 passed / 23 skipped** (was 945; +16 in `mfaPh2.test.ts`) |
| Frontend `tsc --noEmit` | 0 errors |
| Frontend vitest | **338 passed** (was 318; +17 in `security/security.test.tsx`, 5 existing tests updated for the new call shapes / admin redirect) |
| Live SQL dry run (`BEGIN` + migration + `supabase/tests/s_2fa_ph2_live.sql` + `ROLLBACK`, `--linked`) | **9/9**; function absent afterwards (rolled back) |

Notes:
- `adminAuthGuard.test.ts > destructive rate limit > /users/x/delete` fails about 1 run in 6 in the full suite and
  10/10 passes alone. Timing flake, pre-existing, untouched by this branch.
- The main tree's `backend/node_modules` has no `@simplewebauthn/server` (never re-installed after Ph1). This
  worktree links the `s-2fa` worktree's `node_modules` (same `package.json`). Run `npm ci` in `backend/` on the main
  tree before testing there.

## Security review

Focused review of `dev...feature/s-2fa-ph2` (2026-10-27, read-only subagent; H1 reproduced in node before fixing).

| Finding | Severity | Status |
|---|---|---|
| **H1** `safeNextPath` let `/.//evil.example` (and `/%2e//…`, `/a/..//…`) through: the URL parser turns them into `//evil.example`, and react-router hands a protocol-relative path to `window.location`. Pre-existing, but Ph2 adds more `?next=` entry points, and an attacker page after a real second step could phish a fresh code | High | **Fixed**: reject a parsed pathname starting with `//`; 4 new cases in `tokens/lib/lib.test.ts` |
| **M1** "Staff passkey only" and "no backup code for token actions" can be stepped around: a code may confirm `factor_add` (on purpose, for a lost phone), so password + TOTP or password + a backup code can add an attacker passkey and then use passkey step-ups. Ph1 already allowed this; Ph2 makes it worse, because adding the passkey now signs the owner out everywhere | Medium | **Open → Boss decision** (see below) |
| No email to the owner when a token is released (the TOTP release path skips the "factor added" email tripwire) | Medium | **Open → Ph3** (add a release + transfer-completed notice) |
| **L1** An ended session's access token still works straight against PostgREST/Storage (RLS-limited) until it expires, about 1 h; the backend refuses it at once (`getUser`) | Low | Accepted, noted |
| **L2** Staff factor audit is best-effort (after commit, logs on failure) | Low | Accepted; alert on `mfa_staff_audit_failed` with S-OPS |
| **L3** Shared 30/min per-IP budget can bite users behind one carrier NAT | Low | Accepted |

Checked and fine: grant binding (no cross-action / cross-target reuse); refused codes never spent or counted; TOTP
replay between sign-in and step-up blocked (`last_used_step`); `staffRole` = active `admin_users` rows only, fails
closed; the SQL function (definer, search_path, grants, NULL guard, keeps caller, type matches); limiter order and
`trust proxy`; audit rows hold method + ids only; backup codes / TOTP secret never stored, logged or put in a URL; QR
drawn locally; `sessionKeyOf` is a cache key only; admin guard cannot bounce-loop; frontend skips don't matter (the
server refuses).

**M1 options (Boss):** (a) once an account has a passkey, adding another needs a passkey (codes only when no passkey
is left, i.e. the lost-phone case); (b) a passkey added with a code waits 24 h before it can confirm token or admin
actions or remove other methods, with an email to the owner straight away; (c) staff only: (a), everyone else (b).
Recommendation: **(b)**, it keeps lost-phone recovery and gives the owner a day to react; it pairs with the Ph3
recovery hold.

## Open → Ph3 / Ph4 / Boss

| Item | Where |
|---|---|
| **Password / email change without the second factor** (Ph1 Medium). Supabase has no "before user update" hook. Options: **A** BEFORE UPDATE trigger on `auth.users` refusing `encrypted_password` / `email_change` changes for accounts with a factor unless a one-time permit (written by our backend after second factor + step-up) exists; needs a dry run to confirm Supabase still allows triggers on `auth.users`, plus an in-app reset screen. **B** turn on Supabase "Secure password change" + "Secure email change" now (config only). **C** detect + alert only. Recommendation: B now, A behind a dry run | **Boss decision** |
| Email-code recovery (hold + freeze), backup email, Postmark server split | Ph3 (Boss decision today) |
| Break-glass attestation + AAGUID allowlist; trust-on-first-use of the first factor | Ph4 |
| KMS for TOTP secrets; cross-environment origin test; publishable-key route/RPC audit re-run | S-2FAb remaining |
| Click-through on iOS Safari + Android Chrome with real passkeys (Boss's YubiKeys for super_admin) | Ph4 |

## To deploy (staging)

1. `supabase db push --linked` (migration `20261027000008`), then
   `supabase db query --linked -f supabase/tests/s_2fa_ph2_live.sql` → expect `RESULTS {"ok": 9, "total": 9 …}`.
2. Boss pushes `dev`; `scripts/verify-backend-deploy.sh`.
3. `scripts/deploy-frontend.sh staging` (Boss). Grep `dist/assets` for `pk_test_` first (frontend gotcha).
4. Signed-in smoke: Settings → Security loads (a 503 means the MFA secrets are missing on App Runner).
