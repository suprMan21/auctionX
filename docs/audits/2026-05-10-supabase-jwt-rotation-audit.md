# Supabase JWT Rotation Audit — 2026-05-10

**Status:** READ-ONLY AUDIT. No keys rotated, no env vars changed, no code modified during this session.
**Author:** Claude (Opus 4.7) under Boss's supervision.
**Triggered by:** Original "Task E" runbook in `lets-move-to-the-cryptic-rainbow.md` framed App Runner JWT rotation as a "pure env swap, no code changes." `docs/TODO.md:82-86` documents that Session K already attempted that swap and rolled back because the admin dashboard broke. This audit is the prerequisite to any rotation retry — per `feedback_audit_first_when_rollback_documented.md`.

---

## 1. Session K post-mortem

**Honest finding: no smoking gun was located in the explored surfaces.** Two parallel sweeps (one targeted at JWT-decoding code, one at every key-consumption surface) did not produce a confirmed root cause for the Session K admin breakage. The most plausible candidates are listed below in ranked order with the observation that would confirm each.

### What the TODO says happened
`docs/TODO.md:82-86` (Session K, marked DONE):
> Root cause: App Runner had `sb_secret_...` format key instead of JWT for `SUPABASE_SERVICE_ROLE_KEY`. Updated local `backend/.env` and App Runner env vars via `aws apprunner update-service`. Admin dashboard, Users, Audit Logs all verified working on staging.

The fix was: change App Runner `SUPABASE_SERVICE_ROLE_KEY` **from** `sb_secret_*` **back to** a legacy JWT. Admin then worked. The TODO does not specify *which* admin endpoint(s) broke or *what error* was returned.

### Hypothesis 1 — Stale Supabase JS SDK behaviour with `sb_secret_*` (most likely)
**Surface:** `backend/src/lib/supabase.ts:8-13`, `backend/src/middleware/adminAuth.ts:12`, `backend/src/middleware/auditLog.ts:5`, plus every admin route + controller listed in §2.

**Why it might break:** `@supabase/supabase-js` is at `2.93.1` per `backend/package.json`. The `sb_secret_*` format is newer than legacy JWTs; older SDK builds prepend `Bearer <key>` for the `apikey` header but historically also send `Authorization: Bearer <key>` against PostgREST and Edge Function gateway. Once the value is non-JWT, gateway-level JWT verification (where applicable) returns 401, surfacing as 5xx through the backend's error middleware. In `adminAuth.ts:62-66` the service-role client is used for an `admin_users` lookup against PostgREST — if PostgREST in front of Postgres rejects an `sb_secret_*` Authorization header, every admin call fails fast.

**Test that would confirm:** on a *staging* App Runner instance, swap to `sb_secret_*`, hit `GET /api/v1/admin/users`, and capture (a) the HTTP status, (b) the body, (c) the App Runner logs around the call. If logs show an upstream 401 from `*.supabase.co/rest/v1/admin_users`, this is the cause.

### Hypothesis 2 — Misleading Session K root-cause label (likely contributor)
**Surface:** `docs/TODO.md:82-86` itself.

The TODO entry pairs the `sb_secret_*` rollback with an `AWS_REGION` typo fix (`s-east-2` → `us-east-2`). A region typo would cause its own class of failures (S3 bucket lookups, CloudWatch log writes) that could *look* like admin breakage. It is possible that the *real* breakage was the region typo and the key rotation was reverted out of caution rather than confirmed necessity.

**Test that would confirm:** during the same staging swap, keep `AWS_REGION=us-east-2` correct and only flip the key. If admin works, Session K conflated two issues.

### Hypothesis 3 — Zero-trust session check on admin user JWT (low likelihood — incorrectly suspected initially)
**Surface:** `backend/src/middleware/adminAuth.ts:92-94`:
```ts
const payloadBase64 = token.split('.')[1];
const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
const tokenIssuedAt: number = payload.iat ?? 0;
```
This decodes a JWT by string-splitting on `.`. A non-JWT input would yield `undefined`, then a `Buffer.from(undefined, 'base64')` failure / NaN `iat`.

**Why this is NOT the cause:** the `token` variable here is the value extracted from the request's `Authorization: Bearer <…>` header, which is the **admin user's session JWT**, not the service-role key. The service-role key never passes through this code path. Documented here so a future investigator does not chase the same false trail.

**Worth noting anyway:** the implementation does assume JWT format with no defensive guard. If Supabase ever issues non-JWT user tokens (e.g. opaque session tokens), this breaks. Out of scope for the rotation audit but should be added to a hardening pass.

### Hypothesis 4 — Edge Function gateway with `verify_jwt:true` rejects non-JWT Authorization
**Surface:** Five edge functions still default to `verify_jwt:true` because they have no `config.toml`: `place-bid`, `listings`, `process-payment`, `payment-webhook` (already false via deploy), `settle-auction`, `check-payment-window`, `reconcile-escrow`. (Per §2: `release-escrow` is the only one with an explicit `verify_jwt = false` config.toml as of this audit.)

If any backend code path passes the service-role key as an `Authorization: Bearer …` header into an edge function gateway with `verify_jwt:true`, `sb_secret_*` would cause a 401 there. Agent B confirmed **no such pattern exists in the explored backend code** — every backend service-role usage goes through `createClient(url, key)`, not direct fetch with Bearer. This rules the hypothesis out for the *backend*, but pg_net or a similar internal caller could still trigger it.

**Test that would confirm:** during the staging swap, monitor Supabase Edge Function logs for sudden `UNAUTHORIZED_NO_AUTH_HEADER` or 401 spikes after the rotation.

### Recommendation for the next session
Do not treat any hypothesis as confirmed. Run the rotation **on staging only**, with rollback ready, and capture HTTP traces from the first failing endpoint. The post-mortem entry should be updated with the actual error path observed.

---

## 2. Surface inventory

Every place a Supabase key (anon, service-role, publishable, `sb_secret_*`) is referenced or stored. File paths are project-relative to `unmentionables/Unmen/`.

| Surface | File:line | Env var | Key type currently | 1Password mapping |
|---|---|---|---|---|
| **Backend (Node.js/Express)** | | | | |
| Lib client (anon) | `backend/src/lib/supabase.ts:8` | `SUPABASE_ANON_KEY` | Legacy JWT | `op://AM_Development/Supabase Staging/anon-key` |
| Lib client (service-role) | `backend/src/lib/supabase.ts:13` | `SUPABASE_SERVICE_ROLE_KEY` | Legacy JWT | `op://AM_Development/Supabase Staging/cli-admin-ops` |
| `adminAuth` (anon for user JWT verify) | `backend/src/middleware/adminAuth.ts:7` | `SUPABASE_ANON_KEY` | Legacy JWT | anon-key |
| `adminAuth` (service-role for admin lookups) | `backend/src/middleware/adminAuth.ts:12` | `SUPABASE_SERVICE_ROLE_KEY` | Legacy JWT | cli-admin-ops |
| `auditLog` middleware | `backend/src/middleware/auditLog.ts:5` | `SUPABASE_SERVICE_ROLE_KEY` | Legacy JWT | cli-admin-ops |
| Controllers (service-role, RLS bypass) | `backend/src/controllers/{bid,delivery,payout,nfc,sellerVerification,notification,messaging,settlement,stripeConnect,search}Controller.ts` | `SUPABASE_SERVICE_ROLE_KEY` | Legacy JWT | cli-admin-ops |
| Admin routes (service-role) | `backend/src/routes/admin/{auditLogs,disputes,escrow,health,moderation,sellerVerification,users}.ts` | `SUPABASE_SERVICE_ROLE_KEY` | Legacy JWT | cli-admin-ops |
| Script (NTAG simulator) | `backend/scripts/ntag-simulator.ts:50` | `SUPABASE_SERVICE_ROLE_KEY` | Legacy JWT | cli-admin-ops |
| Backend env template | `backend/.env.op:9-11` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Legacy JWT | url / anon-key / **cli-admin-ops** |
| **Edge Functions (Deno)** | | | | |
| `_shared` anon getter | `supabase/functions/_shared/utils/supabase.ts:5` | `SUPABASE_ANON_KEY` | Auto-injected by Supabase | platform-managed |
| `_shared` service-role getter | `supabase/functions/_shared/utils/supabase.ts:15` | `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected by Supabase | platform-managed |
| `ProcessorFactory` (anon) | `supabase/functions/_shared/payment/ProcessorFactory.ts:39` | `SUPABASE_ANON_KEY` | Auto-injected | platform-managed |
| `place-bid` | `supabase/functions/place-bid/index.ts:16` | `SUPABASE_ANON_KEY` | Auto-injected | `verify_jwt: default true` |
| `listings` | `supabase/functions/listings/index.ts:17` | `SUPABASE_ANON_KEY` | Auto-injected | `verify_jwt: default true` |
| `process-payment` (anon) | `supabase/functions/process-payment/index.ts:53` | `SUPABASE_ANON_KEY` | Auto-injected | `verify_jwt: default true` |
| `process-payment` (service-role) | `supabase/functions/process-payment/index.ts:92` | `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected | `verify_jwt: default true` |
| `settle-auction` | `supabase/functions/settle-auction/index.ts:78` | `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected | `verify_jwt: default true`, custom `x-settle-secret` header |
| `payment-webhook` | `supabase/functions/payment-webhook/index.ts:90` | `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected | `verify_jwt: false` (deployed) |
| `check-payment-window` | `supabase/functions/check-payment-window/index.ts:57` | `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected | `verify_jwt: default true` |
| `release-escrow` | `supabase/functions/release-escrow/index.ts:68` | `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected | **`verify_jwt: false` (config.toml committed today)** |
| `reconcile-escrow` | `supabase/functions/reconcile-escrow/index.ts:73` | `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected | **`verify_jwt: false` (deployed) but no config.toml in source** |
| Edge env template | `supabase/.env.local.op:5-7` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Legacy JWT | url / anon-key / **service-role-key** *(different vault item than backend!)* |
| **Frontend (React/Vite)** | | | | |
| Library client | `frontend/src/lib/supabase.ts:4-5` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Legacy JWT (publishable variant) | url / anon-key |
| Edge func URL builders | `frontend/src/pages/SettlementPage.tsx:40-41`, `frontend/src/features/profile/lib/s3Upload.ts:39` | `VITE_SUPABASE_URL` | URL only | url |
| Preflight env validator | `frontend/src/test/preflight/environment.test.ts:4-11` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | (test-time) | n/a |
| Frontend env template | `frontend/.env.op:5-7` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Legacy JWT | url / anon-key (×2 references) |
| **Mobile (Flutter)** | | | | |
| Hardcoded constant | `mobile/lib/core/constants/api_constants.dart:5` | n/a — **literal string in source** | **`sb_publishable_*` (already new format)** | none |
| Initialiser | `mobile/lib/main.dart:22-25` | (consumes constant above) | same | n/a |
| **Deployment surfaces (not in repo)** | | | | |
| AWS App Runner backend | console env | `SUPABASE_SERVICE_ROLE_KEY` | Legacy JWT (current; sb_secret_* attempted Session K, rolled back) | manual via `aws apprunner update-service` |
| Vercel frontend | console env | `VITE_SUPABASE_*` | Legacy JWT publishable | Vercel dashboard |
| Supabase Edge Function project secrets | Supabase dashboard | `SUPABASE_SERVICE_ROLE_KEY` (auto-injected per project) | Legacy JWT | platform-managed |

### Divergences flagged

1. **Vault path mismatch (backend vs edge functions).** `backend/.env.op` resolves `SUPABASE_SERVICE_ROLE_KEY` from `op://AM_Development/Supabase Staging/cli-admin-ops`; `supabase/.env.local.op` resolves it from `op://AM_Development/Supabase Staging/service-role-key`. These are **different items** in the same vault. If they hold different values, backend and local edge function dev environments are out of sync. Confirm in 1Password whether both items hold the same legacy JWT today — the rotation will need to update *both* items (or consolidate to one).
2. **Mobile holds a `sb_publishable_*` value literally in source code (`mobile/lib/core/constants/api_constants.dart:5`).** Already on the new format and already exposed in git history. Rotation needs a separate path for mobile (rebuild + push). See §5.
3. **`reconcile-escrow` has `verify_jwt:false` in deployed state but no `config.toml` in source.** A future redeploy via `supabase functions deploy reconcile-escrow` without `--no-verify-jwt` would silently re-enable JWT verification and break its cron caller. Add a `config.toml` here too as a follow-up.
4. **Five edge functions still have `verify_jwt: default true`:** `place-bid`, `listings`, `process-payment`, `settle-auction`, `check-payment-window`. These are user-facing or cron-driven with custom secrets. Most are safe (user JWT or shared-secret-only); `settle-auction` and `check-payment-window` use shared secrets but still verify gateway JWT on top — they need a similar `verify_jwt:false` if they're ever called from pg_cron.

---

## 3. Rotation impact matrix

For each surface, the impact of swapping the value to `sb_secret_*` (service-role) or `sb_publishable_*` (anon) **without other code changes**.

| Surface | Swap action | Impact category | Reasoning |
|---|---|---|---|
| Backend `lib/supabase.ts` service-role | JWT → `sb_secret_*` | ⚠️ Likely needs verification | Hypothesis 1 in §1 — SDK + PostgREST behaviour under non-JWT key is the unknown. Test on staging first. |
| Backend `adminAuth.ts:12` service-role | JWT → `sb_secret_*` | ⚠️ Same as above | Inherits library client behaviour; admin user-token path on lines 92-94 is *unaffected* (operates on user JWT). |
| Backend `auditLog.ts:5` service-role | JWT → `sb_secret_*` | ⚠️ Same as above | Same SDK + PostgREST surface. |
| All backend controllers using service-role | JWT → `sb_secret_*` | ⚠️ Same as above | All go through `createClient(url, key)`. If lib works, they all work. |
| Backend `SUPABASE_ANON_KEY` | JWT → `sb_publishable_*` | ✅ Likely safe | Anon key is used for `auth.getUser()` calls which are designed to handle either format. |
| Edge function `SUPABASE_SERVICE_ROLE_KEY` (auto-injected) | JWT → `sb_secret_*` | ✅ Drop-in safe | Edge functions consume via `createClient(url, key)`. Supabase platform handles the auto-injection — rotation happens at the project level. |
| Edge function `SUPABASE_ANON_KEY` (auto-injected) | JWT → `sb_publishable_*` | ✅ Drop-in safe | Same reasoning. |
| Frontend `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | already publishable | ✅ Drop-in safe | Already half-migrated. Just confirm Vercel env matches Supabase dashboard. |
| Mobile hardcoded `sb_publishable_*` | already new format | ✅ Already done | Will need re-rotation if the Supabase project regenerates publishable key. |
| AWS App Runner env | JWT → `sb_secret_*` | ⚠️ NEEDS THE STAGING PROBE | Source of the original Session K rollback. Boss runs `aws apprunner update-service` after the staging probe gives a green light. |
| Vercel frontend env | JWT → `sb_publishable_*` | ✅ Drop-in safe | Boss verifies in Vercel console. |
| 1Password `cli-admin-ops` (vault item) | JWT → `sb_secret_*` | ✅ Mechanical | Boss updates the value; backend `op run --env-file` picks it up next launch. |
| 1Password `service-role-key` (vault item) | JWT → `sb_secret_*` | ✅ Mechanical | Same — but this is the diverged second item. See §6 open questions. |
| 1Password `anon-key` (vault item) | JWT → `sb_publishable_*` | ✅ Mechanical | Same. |

Categories: ✅ drop-in safe / ⚠️ needs validation / ❌ will break.

There are no ❌ entries because Agent B did not find a code path that would categorically break under the new format — the unknowns (⚠️) all need the staging probe.

---

## 4. Sequenced rotation plan

Do not execute today. This is the recommended order for the next session.

### Stage 0 — pre-flight (read-only)
1. Confirm in 1Password (Boss) what current values are in `cli-admin-ops`, `service-role-key`, and `anon-key`. If the two service-role items diverge, decide which is canonical and align both *before* rotation.
2. Generate the new keys in Supabase Dashboard → Settings → API → "JWT keys" (or equivalent). Capture the new values *separately* per role: `sb_secret_*` for service-role, `sb_publishable_*` for anon.

### Stage 1 — staging probe (the Session K test)
3. On a *staging* App Runner instance only (NOT prod), update `SUPABASE_SERVICE_ROLE_KEY` to `sb_secret_*` via `aws apprunner update-service`. Keep prod on legacy JWT.
4. Capture `GET /api/v1/admin/users`, `GET /api/v1/admin/audit-logs`, `GET /api/v1/admin/health` HTTP responses + App Runner logs + Supabase API logs immediately after the deploy. **This is the post-mortem evidence-gathering step that Session K skipped.**
5. If admin works, file the observed call traces back into this audit's §1 to close out the hypotheses.
6. If admin breaks, capture the exact failing endpoint + status + log line. Then either fix the underlying code OR roll staging back. Do not proceed to Stage 2 until a fix is in place AND re-tested on staging.

### Stage 2 — backend rotation (after Stage 1 green)
7. Update `op://AM_Development/Supabase Staging/cli-admin-ops` to `sb_secret_*` in 1Password.
8. Update `op://AM_Development/Supabase Staging/service-role-key` to the same `sb_secret_*` (or consolidate — see §6).
9. Update `op://AM_Development/Supabase Staging/anon-key` to `sb_publishable_*`.
10. Update prod App Runner `SUPABASE_SERVICE_ROLE_KEY` to `sb_secret_*` via `aws apprunner update-service`.
11. Restart any locally-running `op run --env-file` backend.

### Stage 3 — frontend rotation
12. Update Vercel env `VITE_SUPABASE_ANON_KEY` and `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY` (Boss). Trigger a new deployment.
13. Run preflight env validator (`frontend/src/test/preflight/environment.test.ts`) post-deploy to confirm the new key still passes the length check (≥ 20).

### Stage 4 — edge function rotation
14. Rotate `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` at the Supabase *project* level (Dashboard → Settings → API). All edge functions auto-inject. No code redeploy needed.
15. Manually invoke each cron-style function once to confirm it still authenticates: `release-escrow`, `reconcile-escrow`, `check-payment-window`. Use the same vault-based secret pattern as today's `release-escrow` test.
16. Add `config.toml` with `verify_jwt = false` to `reconcile-escrow` source to lock the deployed setting (follow-up cleanup).

### Stage 5 — mobile rotation (only if anon key was actually rotated)
17. See §5 for the standalone follow-up.

### Rollback procedure (any stage)
- Revert the value in 1Password (or App Runner / Vercel / Supabase dashboard) to the pre-rotation legacy JWT.
- Restart the affected service.
- Re-run the affected smoke-test endpoint.
- Update this audit with the exact failing surface and the next test to try.

---

## 5. Mobile hardcoded-key follow-up

`mobile/lib/core/constants/api_constants.dart:5` contains the `sb_publishable_*` value as a literal string. This is a SECURITY follow-up that is independent of the JWT rotation.

**Concrete tasks (follow-up session, not blocking rotation):**
1. Replace the constant with a `String.fromEnvironment('SUPABASE_PUBLISHABLE_KEY')` lookup with a build-time injection via `--dart-define`.
2. Add the publishable key to 1Password (e.g. `op://AM_Development/Supabase Staging/mobile-publishable-key`) so it is provisioned consistently with backend / frontend.
3. Wire the Flutter build script to inject the value (typical pattern: `flutter build apk --dart-define=SUPABASE_PUBLISHABLE_KEY=$(op read op://...)`).
4. Update CI / build instructions accordingly.
5. Note in the rotation runbook that mobile rotation requires a **rebuild + redistribute**, unlike web (env var change). Old app installs continue running with the old key until users update.
6. Decide whether the historical key in git history needs revocation. The publishable key is by design safe to expose, but Boss may still prefer regeneration for hygiene.

---

## 6. Open questions for Boss

1. **Vault item canonicalisation.** Backend's `.env.op` resolves service-role from `cli-admin-ops`; edge function `.env.local.op` resolves from `service-role-key`. Are these two items currently the same value? If yes, recommend consolidating to one item (e.g. `service-role-key`) and updating `backend/.env.op`. If no, surface the divergence and decide which is canonical *before* rotation.
2. **Vercel env var inventory.** The audit cannot read the Vercel project console. Boss should confirm in Vercel which Supabase env vars are set and whether they match `frontend/.env.op` (URL, anon key, publishable default key).
3. **Staging App Runner.** Is there currently a separate staging App Runner instance, or is `auctionx-backend-staging` the one prod deploys to? Stage 1 of the rotation plan needs an instance Boss is willing to break for ~30 minutes.
4. **Session K mystery.** Boss may remember which admin endpoint specifically returned errors during the Session K rollback. That single observation could collapse Hypothesis 1 / 2 of §1 to one. If Boss has App Runner logs from that period (CloudWatch retention permitting), pulling them would close the post-mortem properly.
5. **`@supabase/supabase-js` version.** v2.93.1 is the backend's pinned version. Should the rotation plan include an SDK bump first, in case a newer version handles `sb_secret_*` more transparently? Decision is Boss's — this audit does not recommend it without more information.
6. **IaC for App Runner.** Are App Runner env vars managed anywhere else (Terraform, CDK, GitHub Actions) besides the manual `aws apprunner update-service` call? If so, the rotation must update that source too — otherwise the next deploy will revert.

---

## Appendix A — explored files (not modified)

- `backend/src/lib/supabase.ts`
- `backend/src/middleware/adminAuth.ts`
- `backend/src/middleware/auditLog.ts`
- `backend/src/controllers/{bid,delivery,payout,nfc,sellerVerification,notification,messaging,settlement,stripeConnect,search}Controller.ts`
- `backend/src/routes/admin/{auditLogs,disputes,escrow,health,moderation,sellerVerification,users}.ts`
- `backend/scripts/ntag-simulator.ts`
- `backend/.env.op`, `backend/package.json`
- `supabase/functions/_shared/utils/supabase.ts`
- `supabase/functions/_shared/payment/ProcessorFactory.ts`
- `supabase/functions/{place-bid,listings,process-payment,settle-auction,payment-webhook,check-payment-window,release-escrow,reconcile-escrow}/index.ts`
- `supabase/functions/release-escrow/config.toml`, `supabase/functions/upload-url/config.toml`
- `supabase/.env.local.op`
- `frontend/src/lib/supabase.ts`
- `frontend/src/pages/SettlementPage.tsx`, `frontend/src/features/profile/lib/s3Upload.ts`
- `frontend/src/test/preflight/environment.test.ts`, `frontend/src/test/postflight/deployment.test.ts`
- `frontend/.env.op`
- `mobile/lib/core/constants/api_constants.dart`, `mobile/lib/main.dart`
- `docs/TODO.md` (Session K context)

No edits were made to any of the above during this audit.
