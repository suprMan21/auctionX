# S-2FA Ph1 — Verification (backend)

**Date:** 2026-10-27 · **Branch:** `feature/s-2fa` · **Plan:** `docs/plans/2026-10-27-s-2fa.md`
**Status:** Code complete and tested; migration applied to staging. **Not deployed** (all flags off; nothing
user-visible until Ph2 screens + Ph4 rollout).

## What shipped

| Piece | Where |
|---|---|
| Passkeys (own WebAuthn, `@simplewebauthn/server` 14.0.3, user verification required) | `lib/mfa/mfaService.ts` |
| Authenticator app (RFC 6238, own code, AES-256-GCM secret bound to the account) | `lib/mfa/totp.ts`, `lib/mfa/secretBox.ts` |
| 10 one-time backup codes (HMAC + server pepper, per account; any case/spacing) | `lib/mfa/recoveryCodes.ts` |
| "Second factor done" marker per Supabase session (`mfa_sessions`, JWT `session_id`) | `lib/mfa/store.ts` |
| Step-up: single use, 2 min, bound to user + session + action + target, header `X-Step-Up` | `middleware/mfaGates.ts` |
| API `/api/v1/auth/mfa/*` (status, passkeys, sign-in, step-up, totp, backup codes) | `routes/mfa.ts`, `controllers/mfaController.ts` |
| Gates: second factor on claim, transfer start/complete/cancel, release, disclosure, re-issue; step-up on release, transfer complete, price set/cancel; factor removal always | `routes/tagManagement.ts`, `routes/admin/pricing.ts` |
| Admin gate and claim/transfer gate now check our marker, **not** Supabase `aal2` | `middleware/adminAuth.ts`, `lib/security/twoFactorGate.ts` |
| super_admin break-glass: hardware keys only (synced passkeys refused), no authenticator app, 1 h marker, alert email on every sign-in | `mfaService.ts` |
| Lockout: attempts counted before the code is checked; 5 tries, then locked 15 min, 1 h, 4 h, 24 h on repeats; owner emailed; passkeys unaffected | `begin_mfa_code_attempt` |
| Adding a sign-in method or making new backup codes needs a fresh check; for these (and removal) a code may confirm, so a lost phone is recoverable | `mfaService.ts` |
| Last-factor rule and delete under one row lock | `remove_mfa_factor` |
| Security emails (factor added/removed, backup code used + count left, new codes, break-glass sign-in) | `lib/mfa/mfaEmails.ts` |
| Security event `auth.mfa` (closed set; never codes, ids, keys or nicknames) | `lib/security/securityEvent.ts` |

**Changed from the plan:** the TOTP secret uses the same local AES-GCM envelope as the ownership salt
(`MFA_SECRET_KEY`), not KMS; KMS swaps in later the same way as the salt. Super_admin "step-up on every action"
and the per-action alert email land with Ph3 (approval wrapper), not Ph1.

## Database (migrations `20261027000006_s_2fa_factors.sql`, `20261027000007_s_2fa_review_fixes.sql`)

Seven new tables, all RLS on with no policies, no client grants, service_role only; two atomic functions
(`replace_recovery_codes`, `record_mfa_failure`); hourly `mfa-cleanup` cron. `account_delete_blockers` redefined
(identical to the live definition, md5-checked, plus the seven tables in the exclusion list) so a passkey never
blocks an account delete.

- Dry run (`BEGIN` + migration + checks + `ROLLBACK`): 16/16, nothing persisted.
- Applied: `supabase db push --linked` (only this migration pending).
- Live after both: `supabase db query --linked -f supabase/tests/s_2fa_live.sql` → **RESULTS {"ok": 19, "total": 19}**.
- REST probe with the publishable key: all 7 tables and all 4 functions → `42501 permission denied`.
- `database.types.ts` regenerated (additions only; 0 lines removed).

## Tests

- Backend vitest: **945 passed / 23 skipped**. tsc 0 errors. One unexplained failure in `mfa.test.ts`
  ("a right code resets the count") in 1 of 11 runs, not reproduced since; watch for it.
- New: `mfa.test.ts` (43, real P-256 software passkeys through `@simplewebauthn`), `mfaRouteGates.test.ts`
  (12, gates on the real routes before any controller), `mfaUnits.test.ts` (15, incl. RFC 6238 vectors).
- Rewritten: `adminAuthGuard.test.ts` (aal2 alone now refused; marker per session; expired; other session;
  sub mismatch; DB error fails closed), `tagLifecycle.test.ts` claim gate.
- Mutation checks (each change made the suite fail, then reverted): registration without user verification;
  synced passkey allowed for super_admin; assertion without owner check; last-factor rule off; enrolment without a
  verified session; second-factor gate removed from `/transfer/initiate`.
- `schemaColumnDrift` now covers `lib/mfa/store.ts`.

## Security review (2026-10-27, independent agent) and what was done

| Finding | Severity | Outcome |
|---|---|---|
| A stolen verified session could add its own passkey / take new backup codes, then remove the owner's | High | **Fixed**: `factor_add` / `recovery_regen` step-ups; tests |
| Last-factor rule raced (two removals at once) | Medium | **Fixed**: `remove_mfa_factor` under a row lock; live check 17/18 |
| Lockout check and count were separate (≈10 tries per window); no escalation; no email | Medium | **Fixed**: counted before checking, escalating locks, owner email |
| super_admin "hardware key only" relies on the key's own BE/BS flags (`attestation: none`) | Medium | **Open → Ph4**: direct attestation + Yubico root + AAGUID allowlist, set up with Boss's YubiKeys. Now also needs a fresh check to add a key, and every super_admin factor change alerts the break-glass inbox |
| Password (and email) can still be changed straight through Supabase with only the password | Medium | **Open → Ph2**: route password/email change through a backend endpoint behind the second factor; Boss turns on Supabase "Secure password change" |
| TOTP-only accounts cannot do a passkey-only step-up | Medium | **By design** (release decision: passkey). Ph2 asks every user to add a passkey; see flag order below |
| Step-up spent before the handler runs (a refused action burns it) | Low | Accepted (user taps again) |
| Rate limits are per App Runner instance | Low | Accepted; the database lockout is the global limit |
| First factor is trust-on-first-use when 2FA becomes mandatory | Low | **Open → Ph4**: consider an email confirmation before the first factor counts |
| Preheader not escaped; GCM tag length not pinned; duplicate credential → 503; null fields from some browsers refused | Low | **Fixed** |

## Flag order (Ph4)

1. Secrets + WebAuthn env set; every user and admin adds a passkey (Ph2 screens).
2. `FEATURE_REQUIRE_2FA=true`, then `FEATURE_REQUIRE_ADMIN_2FA=true`.
3. `FEATURE_REQUIRE_STEP_UP=true` **last**: a step-up needs a session that already passed its second factor,
   and a passkey.

## Not yet verified

- ✅ **The Supabase store against staging**: `backend/scripts/mfa-store-smoke.ts` run by Boss 2026-10-27:
  **30/30**, cleanup ok, 0 leftover rows. (Run with only `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` as `op://`
  env vars: the full `.env.op` fails on the missing optional `Security` item.)
- Real browsers (iOS Safari, Android Chrome, YubiKey): Ph4.

## Before deploy (Boss)

1. Create the `S-2FA` 1Password item (command in `backend/.env.op`), uncomment the two lines.
2. App Runner env: `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_ORIGINS`, `MFA_SECRET_KEY`,
   `MFA_RECOVERY_PEPPER`, `BREAK_GLASS_ALERT_EMAIL`; leave `FEATURE_REQUIRE_2FA`, `FEATURE_REQUIRE_STEP_UP`,
   `FEATURE_REQUIRE_ADMIN_2FA` **false**. Without the secrets, `/auth/mfa` answers 503 and nothing else changes.
