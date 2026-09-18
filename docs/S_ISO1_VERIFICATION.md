# S-ISO1 — Parked Marketplace Isolation · Verification

**Branch:** `fix/nfc-rls-key-exposure` → to be merged into `feature/s-iso1-marketplace-isolation` → `dev`
**Date:** 2026-09-18
**Brief:** https://app.notion.com/p/3df3baf696648100a6e2d60eb2adad8d
**Reversal procedure:** `docs/PARKED_MARKETPLACE.md`

---

## Acceptance criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Route inventory before and after committed to `docs/PARKED_MARKETPLACE.md` | ✅ | §2 of that doc — every top-level mount, admin sub-mount and route-level gate |
| 2 | Every marketplace endpoint 404s with the flag off; token endpoints unaffected | ✅ | `backend/src/__tests__/routeAllowlist.test.ts`, 47 specs |
| 3 | Marketplace edge functions return 410 | ✅ | all 8 deployed to staging; 5 return `410 MARKETPLACE_PARKED`, 3 are blocked earlier by gateway JWT — see below |
| 4 | No marketplace cron job scheduled | ⏳ | migration applied, but the `cron.unschedule` block has an exception guard that can silently skip — **one query still needed**, see below |
| 5 | `authenticated` cannot write marketplace tables (tested) | ✅ | live probe: `42501 permission denied for table` on `listings`, `auctions`, `bids`, `settlements` |
| 6 | Lint rule fails on a deliberate marketplace import, then removed | ✅ | proven — see below |
| 7 | Flipping both flags + re-enable SQL restores behaviour on a local instance | ⚠️ | flag half proven by test (flag on restores every parked mount); the re-enable SQL itself is documented but not re-run |
| 8 | `tsc` 0 errors; vitest green; no new skips | ✅ | below |

---

## Test results

```
backend   npx tsc --noEmit     0 errors
backend   npx vitest run       9 files · 127 passed · 21 skipped   (baseline 8 files · 80 passed · 21 skipped)
frontend  npx tsc --noEmit     0 errors
frontend  npm run build        ✓ built in 1.16s
boundary  npm run lint:boundaries   ✔ 0 violations (99 modules, 238 dependencies)
python    tag-encoder          51 passed
python    tag-encoder/providers 14 passed   (outside testpaths — must be invoked explicitly)
python    tag-hq               51 passed
```

**Skip count unchanged at 21** — the same integration specs that need a running server and seeded
categories. No new skips. Net new tests: **47**.

### Boundary lint proven to fire (criterion 6)

Injected into `backend/src/routes/nfc.ts`:
```ts
import { closeAuction } from '../lib/auction/closeOrchestrator';
```
Result:
```
error no-token-to-marketplace: src/routes/nfc.ts → src/lib/auction/closeOrchestrator.ts
x 1 dependency violations (1 errors, 0 warnings). 99 modules, 239 dependencies cruised.
```
Import removed; lint back to 0 violations, `tsc` back to 0 errors.

---

## 🔴 Security finding — fixed in this session, unrelated to parking

**Confirmed live on staging by direct probe before the fix:**

```
GET /rest/v1/nfc_tags?select=id,status,aes_key_enc   apikey: <publishable>
→ HTTP 200, aes_key_enc returned (32 chars)
```

`nfc_tags.aes_key_enc` is the per-tag AES key the entire SUN/SDM authentication scheme rests on. Anyone
holding it can mint valid SUN URLs for that tag — a cryptographic clone.

**Cause** — two things combined:
1. `nfc_tags_public_read` is `FOR SELECT USING (status IN ('registered','active'))` with no owner
   predicate (`20260307100000_nfc_session_l_schema.sql:44`).
2. `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO anon`
   (`20260201042342_remote_schema.sql:2411`) auto-granted every later table; nothing ever `REVOKE`d.

`verification_events_public_read` is `USING (true)` on a table holding `ip_address`, `user_agent` and
`scanned_by` — same shape, PII instead of key material.

**Exposure was negligible in practice:** one tag row on staging, holding what looks like a placeholder
key. The defect, not the data, was the problem — the same policy would have shipped to production tags.

**Fix:** `supabase/migrations/20260918000000_fix_nfc_rls_key_exposure.sql` — owner-scoped read policies,
write grants revoked on the NFC tables, and the blanket default privilege revoked so future tables cannot
silently re-open. Safe because every backend read of these tables uses `getServiceClient()` (bypasses RLS),
and neither the React app nor the Flutter app queries them directly.

**Still open, tracked for S-SEC1:** `public.users` has `"Anyone can view users" FOR SELECT USING (true)`
— a privacy concern under anonymous ownership, though not key material. Its `UPDATE` policy also
self-references `users`, violating the "RLS must never self-reference" lesson.

---

## Staging verification (2026-09-18, after Boss pushed + ran `supabase db push --linked`)

### 🔴 The key exposure is CLOSED

Same probe that returned the key before the fix:
```
GET /rest/v1/nfc_tags?select=id,status,aes_key_enc   apikey: <publishable>
→ HTTP 200, rows: 0, rows exposing aes_key_enc: 0
```
`verification_events` likewise returns nothing to anon.

### Marketplace writes revoked
```
POST /rest/v1/listings     → 401 {"code":"42501","message":"permission denied for table listings"}
POST /rest/v1/auctions     → 401 42501
POST /rest/v1/bids         → 401 42501
POST /rest/v1/settlements  → 401 42501
```

### Edge functions gated
All 8 deployed. `release-escrow`, `reconcile-escrow`, `payment-webhook`, `settle-auction` and `listings`
return **410 `MARKETPLACE_PARKED`**. `process-payment`, `place-bid` and `check-payment-window` return 401
at the gateway (`verify_jwt = true`), so the request is blocked before it reaches the gate — a stronger
block, not a weaker one. `waitlist-welcome` correctly still answers with its own auth, not the gate.

**`payment-webhook` and `settle-auction` gained a `config.toml` (`verify_jwt = false`) in this session.**
They were deployed with JWT verification off but had no config in source, so shipping the 410 gate would
have silently regressed them to gateway-JWT and broken both. Both were deployed `--no-verify-jwt` and
probed.

### ⏳ Still to verify — one query

The `cron.unschedule` block in `20260918000003` is wrapped in an exception guard that downgrades
`undefined_table` / `insufficient_privilege` to a NOTICE, so it *could* have skipped silently. The grants
in the same migration demonstrably applied, but that does not prove the unschedule did. Confirm with:

```sql
SELECT jobname, schedule FROM cron.job;
-- expect: neither 'release-escrow-tick' nor 'reconcile-escrow-daily'
```

---

## Deviations from the brief

1. **`/nfc/proof` + `/proof/confirm` kept live.** The brief calls them IPFS pin endpoints; they are
   actually S3 presign/confirm (`backend/src/lib/s3.ts`). Only `/nfc/mint` touches Pinata. They are the
   token-first origin-video path, so parking them would have broken the product.
2. **`/api/v1/notifications` and admin `/users`, `/audit-logs`, `/verifications` kept.** Generic account
   and compliance infrastructure the token platform needs, not marketplace surfaces.
3. **`upload-url` edge function not gated.** A generic S3 presigner the token origin-video flow needs.
4. **`payment-webhook` and `settle-auction` `config.toml` left missing.** A real `verify_jwt` regression
   trap, but both are parked and return 410, so it cannot bite while the marketplace is off. Recorded as an
   un-park prerequisite in `docs/PARKED_MARKETPLACE.md` §3 rather than fixed as scope creep.
5. **SPA 404 is a rendered page, not an HTTP 404 status.** A client-rendered app cannot set the status
   code; a CloudFront/host rewrite would be needed.
6. **Health endpoint moved before the body parsers**, per the Every-Session lesson. It was previously
   mounted after `cors` and `express.json()`.

---

## Files changed

**New:** `backend/src/app.ts` · `backend/src/lib/featureFlags.ts` ·
`backend/src/__tests__/routeAllowlist.test.ts` · `frontend/src/pages/NotFoundPage.tsx` ·
`supabase/functions/_shared/marketplaceGate.ts` ·
`supabase/migrations/20260918000000_fix_nfc_rls_key_exposure.sql` ·
`supabase/migrations/20260918000003_park_marketplace_grants.sql` · `.dependency-cruiser.cjs` ·
`.github/workflows/ci.yml` · `docs/PARKED_MARKETPLACE.md` · `docs/S_ISO1_VERIFICATION.md`

**Modified:** `backend/src/server.ts` (reduced to a listener) · `backend/src/routes/admin/index.ts` ·
`backend/src/routes/nfc.ts` · `frontend/src/App.tsx` · `frontend/src/components/navigation/Header.tsx` ·
`frontend/src/features/admin/AdminLayout.tsx` · `frontend/src/lib/featureFlags.ts` ·
`frontend/src/vite-env.d.ts` · `package.json` · 8 × `supabase/functions/*/index.ts` · `.gitignore`

**Untracked:** `frontend/tsconfig.tsbuildinfo` — a build artifact that was committed to git and dirtied
every diff (flagged as outstanding in the S-NFC iOS handoff). Now gitignored.

---

## Next

S-NFC3 rev 2 — gated on Boss's checkpoint "go", plus the 1Password unlock for commits and migrations.
S-NFC3 now also carries the **Security Event Logging addendum**
(https://app.notion.com/p/3df3baf6966481e6b01cca8711acffec).
