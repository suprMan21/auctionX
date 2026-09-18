# Parked Marketplace — S-ISO1

**Status:** parked 2026-09-18 · **Nothing is deleted.** Every change below is reversible.

The auction marketplace (S24–S42) and the **Unmentionables** stream are parked per the Locked decision
[Token-first pivot](https://app.notion.com/p/3df3baf69664818b960ff9bd080cd4a8). Code stays deployed but
dormant. **Re-activating the marketplace requires a new Decisions DB entry**, not just flipping these flags.

Boss confirmed 2026-09-18 that nothing uses the marketplace on `pmlofthmobglcfkqjtru` — no demo auctions,
no live data dependencies.

---

## 1. Reversal switchboard

Flip all five and the marketplace is fully live again.

| # | Switch | Where | Parked value | Live value |
|---|---|---|---|---|
| 1 | `FEATURE_MARKETPLACE` | Backend env (App Runner) | unset / `false` | `true` |
| 2 | `VITE_FEATURE_MARKETPLACE` | Frontend build env | unset / `false` | `true` |
| 3 | `MARKETPLACE_ENABLED` | Supabase Edge Function secret | unset / `false` | `true` |
| 4 | pg_cron jobs | Database | unscheduled | run §4 SQL |
| 5 | Table write grants | Database | revoked from `anon`/`authenticated` | run §5 SQL |

```bash
# 3 — edge function secret
supabase secrets set MARKETPLACE_ENABLED=true --project-ref pmlofthmobglcfkqjtru
```

> **App Runner env vars are static literals** — no `op://` resolution. Set the literal string `true`.
> **A Vite shell env var beats a `.env` file** — set `VITE_FEATURE_MARKETPLACE` in the build step.

---

## 2. Route inventory — before and after

`FEATURE_MARKETPLACE` off. "Unmounted" means the request reaches the catch-all and returns
`404 {"error":"Not found"}` — distinct from a mounted controller answering "row not found".

### Top-level mounts (`backend/src/app.ts`)

| Mount | Parked? | Why |
|---|---|---|
| `/api/v1` (health) | **KEEP** | liveness; mounted before the body parsers |
| `/api/v1/nfc` | **KEEP** | token platform (three routes gated inside — see below) |
| `/api/v1/verify` | **KEEP** | public verify page; NDEF URLs physically point here |
| `/api/v1/verification` | **KEEP** | Yoti identity |
| `/api/v1/webhooks/yoti` (raw) | **KEEP** | Yoti webhook |
| `/api/v1/notifications` | **KEEP** | generic user infrastructure |
| `/api/v1/admin` | **MIXED** | sub-allowlist, see below |
| `/api/v1/auctions` | PARKED | |
| `/api/v1/settlements` | PARKED | |
| `/api/v1/delivery` | PARKED | |
| `/api/v1/payouts` | PARKED | |
| `/api/v1/stripe-connect` | PARKED | token fees charge the payer on the platform account; Connect is dormant |
| `/api/v1/webhooks` | PARKED | PaymentCloud IPN |
| `/api/v1/webhooks/stripe-account` (raw) | PARKED | Stripe Connect account webhook |
| `/api/v1/search` | PARKED | searches `listings` |
| `/api/v1/verifications` | PARKED | `createVerification` hard-requires a `listingId` |
| `/api/v1/seller-verification` | PARKED | legacy S3 KYC pipeline, superseded by Yoti |
| `/api/v1/conversations` | PARKED | buyer↔seller marketplace messaging |

### Admin sub-mounts (`backend/src/routes/admin/index.ts`)

The zero-trust stack (`verifyAdminAuth` → `adminRateLimit`) runs **before** the allowlist, so an
unauthenticated probe 401s and never learns whether a path is parked.

| Sub-mount | Parked? | Why |
|---|---|---|
| `/health`, `/users`, `/audit-logs` | **KEEP** | account admin + compliance trail; anonymous ownership still needs suspend/ban |
| `/verifications` | **KEEP** | Yoti ID review (Premier, S-TIER1) |
| `/moderation` | PARKED | `moderation_queue` over listings |
| `/auctions` | PARKED | also imports `triggerSettlement` |
| `/disputes` | PARKED | imports `refundSettlement` |
| `/escrow` | PARKED | |
| `/seller-verification` | PARKED | legacy doc pipeline |

### Route-level parking inside the kept `/api/v1/nfc` router

| Route | Why |
|---|---|
| `POST /nfc/register` | validates `itemId` against `listings`; superseded by `POST /enroll` (S-NFC3) |
| `POST /nfc/transfer` | one-sided, unpaid, instant. **Leaving it live is a free path around the $2.50 transfer fee.** Superseded by the two-sided flow |
| `POST /nfc/mint` | the only NFT/IPFS path. *No NFTs, ever* (Locked, 2026-09-18) |

`POST /nfc/proof` and `/proof/confirm` stay **live** — they are S3 presign/confirm (`lib/s3.ts`), not IPFS.
The S-ISO1 brief described them as IPFS; that was inaccurate. Only `/mint` touches Pinata.

---

## 3. Edge functions

Gated by `supabase/functions/_shared/marketplaceGate.ts`, which returns **410 Gone** with
`{ success: false, error: { code: 'MARKETPLACE_PARKED' } }` unless `MARKETPLACE_ENABLED=true`.
The gate runs immediately after the CORS preflight branch.

**Gated (8):** `process-payment`, `payment-webhook`, `release-escrow`, `settle-auction`,
`reconcile-escrow`, `check-payment-window`, `place-bid`, `listings`.

**Not gated (2):** `waitlist-welcome` (live), `upload-url` (generic S3 presigner the token
origin-video flow needs).

### ⚠️ Un-park prerequisite — `verify_jwt` regression trap

Edge Function deploys default to `verify_jwt = true`. A function with its own auth must deploy with
`--no-verify-jwt`, **every** deploy, and be verified with a curl probe (a no-auth call must return the
function's own 401, not `UNAUTHORIZED_NO_AUTH_HEADER`).

Current state of `config.toml` in source:

| Function | `config.toml` | Risk |
|---|---|---|
| `release-escrow`, `reconcile-escrow`, `upload-url` | `verify_jwt = false` ✅ | safe |
| **`payment-webhook`** | **missing** ⚠️ | has its own Stripe signature check; a redeploy would silently re-enable JWT verification and break the webhook |
| **`settle-auction`** | **missing** ⚠️ | has its own `x-settle-secret` check; same risk |

**Before un-parking, add `config.toml` with `verify_jwt = false` to those two.** Left unfixed here
deliberately: both are parked and return 410, so the trap cannot bite while the marketplace is off.

---

## 4. pg_cron — exact re-schedule SQL

Unscheduled by `supabase/migrations/20260918000003_park_marketplace_grants.sql`. To restore, run verbatim:

```sql
-- release-escrow-tick — every 15 minutes
-- (from 20260509120100_enable_pg_cron_release_escrow.sql:43)
SELECT cron.schedule(
  'release-escrow-tick',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://pmlofthmobglcfkqjtru.supabase.co/functions/v1/release-escrow',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-release-secret',
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'release_escrow_secret')
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- reconcile-escrow-daily — 02:00 UTC
-- (from 20260509150005_escrow_reconciliation.sql:87)
SELECT cron.schedule(
  'reconcile-escrow-daily',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://pmlofthmobglcfkqjtru.supabase.co/functions/v1/reconcile-escrow',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-reconcile-secret',
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'reconcile_escrow_secret')
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
```

> Verify the header/secret names against the source migrations before running — Supabase managed Postgres
> blocks custom-namespace GUCs, so these read from `vault.decrypted_secrets`.

**Never scheduled in the first place** (do not "restore" these):
- `settle-auction` — schedule is commented out at `20260301000001_auction_settlement.sql:241-244`; it is
  invoked on demand from `routes/admin/auctions.ts`.
- `check-payment-window` — its header claims a per-minute cron, but no migration ever created one.

---

## 5. Database grants — re-grant SQL

`20260918000003_park_marketplace_grants.sql` revoked `INSERT/UPDATE/DELETE` from `anon` and
`authenticated` on 24 marketplace tables. `SELECT` was deliberately retained so RLS stays the read gate
and foreign-key integrity checks are unaffected. `service_role` was never touched.

```sql
GRANT INSERT, UPDATE, DELETE ON
  listings, listing_media, categories, auctions, bids,
  settlements, settlement_offers, payment_penalties, payouts, escrow_reconciliation_logs,
  transactions, payments, payment_attempts, crypto_payments, refunds,
  processor_config, processor_health,
  shipping_addresses,
  saved_searches, conversations, messages, moderation_queue,
  seller_verification_documents, seller_verification_reviews
TO anon, authenticated;
```

### Separately: the NFC security hotfix

`20260918000000_fix_nfc_rls_key_exposure.sql` is **not** part of parking and must **not** be reverted when
the marketplace un-parks. It closed a confirmed live exposure — `nfc_tags.aes_key_enc`, the per-tag AES
key, was readable by any anonymous caller. It also revoked the blanket default privilege:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE ON TABLES FROM authenticated;
```

**⚠️ This changes behaviour for every future migration.** A new table is no longer write-granted to
`anon`/`authenticated` by default. Any table that genuinely needs client-side writes must `GRANT`
explicitly. `SELECT` is still granted by default, so RLS remains the read gate.

### Known, still open

`public.users` carries `CREATE POLICY "Anyone can view users" ... FOR SELECT USING (true)`
(`20260201042342_remote_schema.sql:1537`) — a marketplace-era policy for public seller profiles. Under
anonymous token ownership this is a privacy concern, but it is not key material and narrowing it needs a
view-based replacement. **Tracked for S-SEC1.** Its `UPDATE` policy also self-references `users`, which
violates the "RLS policies must never self-reference the same table" lesson.

---

## 6. Frontend

`VITE_FEATURE_MARKETPLACE` (default off) gates, in `frontend/src/App.tsx`:

`/listings/create`, `/listings/:id/edit`, `/my-listings`, `/unmentionables`, `/seller-verification`,
`/seller/verification`, `/seller/verification/return`, `/browse`, `/browse/:categorySlug`, `/search`,
`/listings/:id`, `/auctions/:id`, `/seller/:id`, `/settlements/:settlementId`, `/payouts`,
`/saved-searches`, `/messages`, `/messages/:conversationId`, `/settings/payouts`, and the admin children
`moderation`, `auctions`, `auctions/:id`, `seller-verification`, `escrow`.

Nav and CTAs: `components/navigation/Header.tsx` (12 links, desktop + mobile; guards hoisted outside `<li>`
so a parked link leaves no empty list item) and `features/admin/AdminLayout.tsx` (sidebar filtered).

The `*` catch-all now renders `pages/NotFoundPage.tsx` instead of redirecting to `/`.

> **Open item:** a client-rendered SPA cannot emit a real HTTP 404 status. The page sets
> `<meta name="robots" content="noindex">`; a genuine 404 status needs a CloudFront/host rewrite rule.

---

## 7. Code boundary lint

`.dependency-cruiser.cjs` (repo root), run from `backend/` so rule paths are `src/`-relative:

```bash
npm run lint:boundaries
```

Two rules, both `error`:
- **`no-token-to-marketplace`** — token/NFC/verify/ownership/security modules must not import marketplace
  routers, controllers, admin sub-routers, `lib/auction` or `lib/refundClient`.
- **`no-nft-in-token-flows`** — token flows must never reach `services/nfc/nftMinting`,
  `services/nfc/pinataService` or `contracts/`.

Deliberately **shared** (not violations): `lib/supabase`, `lib/errors`, `lib/logger`, `lib/stripe`,
`lib/s3`, `lib/notifications/*`, `lib/featureFlags`, `middleware/*`.

Enforced in CI by `.github/workflows/ci.yml` (job `boundaries`). Verified to actually fire: injecting
`import { closeAuction } from '../lib/auction/closeOrchestrator'` into `routes/nfc.ts` produced
`error no-token-to-marketplace: src/routes/nfc.ts → src/lib/auction/closeOrchestrator.ts`, and the import
was then removed.

**On un-park:** relax the `from`/`to` globs rather than deleting the rules — `no-nft-in-token-flows` must
survive regardless, since "no NFTs, ever" is not part of the parking decision.

---

## 8. Boss actions (Stripe dashboard — not automatable)

- [ ] Disable the **Stripe Connect** webhook endpoint in the Stripe dashboard.
- [ ] Confirm no marketplace webhook endpoint is registered.
- [ ] The previously-pending `payment-webhook` registration is now moot while parked.

---

## 9. Verification matrix

With `FEATURE_MARKETPLACE` off:

```bash
BASE=https://vw7zy9mkyg.us-east-2.awsapprunner.com

# Parked — expect 404 {"error":"Not found"}
curl -s -o /dev/null -w "%{http_code} %{url_effective}\n" $BASE/api/v1/auctions/$(uuidgen)
curl -s -o /dev/null -w "%{http_code} %{url_effective}\n" $BASE/api/v1/search
curl -s -o /dev/null -w "%{http_code} %{url_effective}\n" $BASE/api/v1/conversations
curl -s -o /dev/null -w "%{http_code} %{url_effective}\n" -X POST $BASE/api/v1/nfc/mint

# Kept — expect 200 / 401 / 400, never the catch-all 404
curl -s -o /dev/null -w "%{http_code} %{url_effective}\n" $BASE/api/v1/health
curl -s -o /dev/null -w "%{http_code} %{url_effective}\n" -X POST $BASE/api/v1/nfc/scan

# Edge functions — expect 410
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://pmlofthmobglcfkqjtru.supabase.co/functions/v1/release-escrow
```

Automated equivalent: `backend/src/__tests__/routeAllowlist.test.ts` (47 specs) asserts every parked path
hits the catch-all with the flag off and every one of them is restored with the flag on.

---

## 10. "Nothing deleted" inventory

Still present in the tree, still typechecking, simply unreachable:

- All 11 parked routers and their controllers (`routes/`, `controllers/`), imported unconditionally in
  `app.ts` so `tsc --noEmit` keeps covering them.
- `lib/auction/` (12 modules + `__tests__/mechanics.test.ts`, still green and still wired to the root
  `npm run test:mechanics`).
- `services/nfc/nftMinting.ts`, `services/nfc/pinataService.ts`, `contracts/` — dormant NFT code, untouched.
- All marketplace tables, rows, RLS policies and functions.
- All 8 gated edge functions, still deployed.
- Frontend pages and components for every parked route.
