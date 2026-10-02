# S-NFC3 — Tag Management API (rev 2) · Verification

**Branch:** `feature/s-nfc3-tag-management`
**Date:** 2026-09-19
**Brief:** https://app.notion.com/p/3843baf6966481448f1bcb6ad07174a9
**Addendum (in scope):** https://app.notion.com/p/3df3baf6966481e6b01cca8711acffec

Scope as confirmed with Boss: **backend + tests only.** Frontend is a separate session.

---

## Test results

```
backend   npx tsc --noEmit       0 errors
backend   npx vitest run         16 files · 252 passed · 21 skipped
                                 (baseline 13 files · 127 passed · 21 skipped)
frontend  npx tsc --noEmit       0 errors
boundary  npm run lint:boundaries  ✔ 0 violations (121 modules, 292 dependencies)
```

**Net new tests: 125. Skip count unchanged at 21 — no new skips.**

The boundary lint cruised 121 modules, not 0 — a lint that processed zero files is a
false green (Every-Session lesson).

| New spec file | Tests | Covers |
|---|---|---|
| `securityEvent.test.ts` | 26 | Zod validation, never-throws, full catalog, redaction sweep |
| `tagLifecycle.test.ts` | 37 | claim / transfer / release / replace / re-issue / disclosure behaviour |
| `tagManagementRoutes.test.ts` | 26 | mounting, route ordering, auth gating, parked routes still parked |
| `tokenFeeWebhook.test.ts` | 13 | signature, completion-only-via-webhook, idempotency |
| `ownershipProof.test.ts` | 11 | independent keccak256, preimage encoding, salt envelope |
| `tokenFees.test.ts` | 7 | USD list price, CAD gating and fallbacks |
| `schemaColumnDrift.test.ts` | 5 | every PostgREST column checked against `database.types.ts` (added in v1.1) |

---

## Acceptance criteria — S-NFC3 brief

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Enroll → origin claim → `ACTIVE`, no chain or IPFS calls | ✅ | `tagLifecycle.test.ts` "moves an ENROLLED tag to ACTIVE"; no Alchemy/Pinata import in any S-NFC3 module |
| 2 | Claim works for an anonymous account with 2FA; `2fa_required` without | ✅ | "blocks the claim when 2FA is required"/"allows the claim with an aal2 token" |
| 3 | Claim on anything but `ENROLLED` rejected with the right code | ✅ | specs for `already_claimed`, `token_released`, `token_retired` |
| 4 | Transfer completes only after webhook success | ✅ | `tokenFeeWebhook.test.ts`; completion spec asserts the client response leaves it `PENDING` |
| 5 | Transfer and gift both charge $2.50; Canadian account charged CAD | ⚠️ | $2.50 for both proven. **CAD is implemented but flag-gated OFF** — see Deviation 3 |
| 6 | Replayed or stale SUN on completion rejected | ✅ | "rejects a stale SUN on completion"; real codec-built SUN messages, not stubs |
| 7 | Transfer to an unregistered email completes after signup | ✅ | "lets an email-targeted recipient complete once they have registered" |
| 8 | Release during pending transfer → `transfer_pending`; previous owner `forbidden` after | ✅ | "is blocked while a transfer is pending" + the 4 previous-owner lockout specs |
| 9 | Release irreversible; later claim returns `token_released` | ✅ | "kills the token irreversibly and stales the proof" re-claims and asserts the error |
| 10 | Replace carries full history; verify shows original origin record | ✅ | "carries the item link, owner and disclosure to the new chip" |
| 11 | Verify page never returns prior owners, undisclosed fields or PII | ⚠️ | Enforced in SQL by `public_tag_provenance`; **not yet tested live** — needs the migration applied (see Outstanding) |
| 12 | Each claim/transfer creates exactly one `current` ID; previous flips `stale` | ✅ | asserted in claim, webhook and replace specs; partial unique index backs it |
| 13 | Receipt preimage recomputes to the stored ID (independent keccak256) | ✅ | `ownershipProof.test.ts` — Keccak-f[1600] implemented from spec in the test, sharing no code with `viem` |
| 14 | Ownership lookup never reveals owner identity; stale IDs reveal nothing | ✅ | `ownershipController.ts` returns only `{status, message}` for stale; route specs |
| 15 | No endpoint accepts an Ownership ID or Receipt as authorization | ✅ | `ownershipAuthProbeDetector` logs and never honours; no handler reads an ownership id |
| 16 | `tsc` 0 errors; vitest green; no new skips | ✅ | above |

## Acceptance criteria — Security Event addendum

| # | Criterion | Status |
|---|---|---|
| 1 | `emitSecurityEvent` Zod-validated, never throws | ✅ null/undefined/string/invalid-payload specs |
| 2 | Every catalog row has a spec asserting emission | ✅ all 15 events, plus a spec asserting the catalog covers the union exhaustively |
| 3 | Each rejection asserts the matching event and `result` | ✅ `already_claimed`, `2fa_required`, `transfer_pending`, `forbidden`, `token_released`, `sun_invalid` |
| 4 | Redaction test over the full lifecycle | ✅ no UID / SUN URL / email / salt in any line; plus a spec that every string-valued key is on an allow-list |
| 5 | No `COMPLETED` without `transfer.state_change` `trigger=webhook` | ✅ asserted positively and as an invariant over all emitted state changes |
| 6 | `tsc` 0 errors; vitest green; no new skips | ✅ |

---

## 🔴 Corrections to the brief

These were verified against the migration files directly, not taken from the brief.

**1. Migration timestamps renumbered `20260918*` → `20260919*`.**
The brief and TODO named `20260918000001` / `...02`, but `20260918000003_park_marketplace_grants.sql`
is **already applied on staging** (S-ISO1). Inserting lower versions behind an applied one puts the
CLI into out-of-order migration territory.

**2. The enum is `nfc_lifecycle_status`, not `tag_lifecycle_status`.**
`RELEASED` already exists; **`SUSPENDED` was missing** and is added.
`transfer_type` already has `GIFT`; `RELEASE` and `REISSUE` are added.
(`20260622000000_nfc_items_decoupling.sql:33`, `20260301100000_nfc_verification.sql:29`)

**3. `ownership_transfers` could not support the brief as written.**
Two columns were still `NOT NULL` and block rev 2 outright:

| Column | Was | Why it blocks |
|---|---|---|
| `verification_id` | `NOT NULL` → `item_verifications(id)` | A token transfer has no item_verification. Every transfer would need a fabricated marketplace-era row. |
| `to_user_id` | `NOT NULL` → `users(id)` | Rule 3 — "a pending transfer can target an email with no account" — is impossible. |

Both relaxed to nullable. Dropping `NOT NULL` **widens** what a column accepts so it cannot
invalidate an existing row; the Schema Extension Rules forbid the inverse. Precedent:
`20260622000000:134` does exactly this to `item_verifications.listing_id`. A new CHECK keeps the
combination honest (a `PENDING` row needs exactly one target; a `COMPLETED` row needs a real user).

**4. `nfc_tags.last_counter` deliberately NOT added.**
The SDM read counter already lives in `nfc_tags.sun_counter` and is what the existing scan path
maintains. A second counter column would split the source of truth on precisely the check that
makes replay detection work. (Matches the TODO's own correction.)

**5. `fee_payer` is `BUYER | SELLER`, not `SENDER | RECIPIENT`.**
A CHECK constraint already pins those values (`20260622000000:196`); the security event schema was
aligned to the database rather than the other way round.

**6. `items` has `origin_event` + `location_visibility`, not `origin_location`.**
It also carries its **own** creator-set disclosure flags (`origin_released`,
`creator_name_visible`, `location_visibility`). So `public_tag_provenance` applies a **double
gate**: a field appears only if the item's CREATOR released it AND the token's CURRENT OWNER chose
to show it. These are different people and neither should override the other; the conjunction is
the restrictive direction. `creator_name` resolves through `items.creator_id`, never
`nfc_tags.seller_id` — that is the staff member who encoded the chip.

---

## Deviations from the brief

1. **2FA enforcement is behind `FEATURE_REQUIRE_2FA`, default OFF.** The locked decision makes 2FA
   mandatory, but there is still **no MFA enrollment path anywhere in the product** (zero hits for
   `mfa|aal|totp` across `backend/src`, `frontend/src` and every migration). Switching it on today
   would make `/claim` and `/transfer/:id/complete` unreachable for every user — an outage, not
   security. **S-2FA is a hard prerequisite before this may default true in production.** Both
   states are tested.

2. **The `$10` re-issue fee is recorded, not charged.** `POST /reissue-request` prices and stores
   the request; no PaymentIntent is created because the brief routes re-issue through *admin review*
   first, and charging before review would mean refunding every rejection. Admin approval (and its
   charge) is not in this session's endpoint list.

3. **CAD presentment is implemented but flag-gated OFF (`FEATURE_CAD_PRESENTMENT`).** The TODO
   carried an open question — CAD presentment is unconfirmed on the sandbox account — with the
   instruction "ship USD-only and defer CAD with a note". With the flag off every account is charged
   in USD with `fx_rate = 1`, which is a correct and fully reconcilable charge. Turning it on
   requires both a CAD-capable Stripe account and `USD_CAD_RATE`; if either is missing the resolver
   falls back to USD rather than inventing a rate. **Criterion 5's CAD half is therefore deferred,
   not delivered.**

4. **The salt envelope is local AES-256-GCM, not AWS KMS.** There is no KMS client in the backend
   and no CMK provisioned. The provider interface mirrors
   `tag-encoder/providers/kms_key_provider.py`, and the emitted `kms.op` events use the KMS
   operation names in both cases, so S-SEC0 detections written against them keep working unchanged
   after the swap. Envelopes are version-prefixed (`v1.`) so a future KMS provider can decrypt old
   rows instead of orphaning them.

5. **New handlers wrap their own error responses.** The shared `errorHandler` emits
   `{ error, requestId }`, not the mandated `{ success, data, error }`. Every parked marketplace
   route depends on the current behaviour, so changing it would be a cross-cutting edit outside this
   session. `routes/tagManagement.ts` wraps instead; the house shape is asserted by spec.

6. **`ASSOCIATED` and `CLAIMED` remain unused**, per rev 2. Origin claim goes straight to `ACTIVE`.

---

## Security notes

- **The webhook is the only writer of `COMPLETED`.** It verifies the signature with its own secret,
  binds the event to the PaymentIntent the transfer actually created (a succeeded intent from
  elsewhere cannot complete someone else's transfer), and is conditional on `status = 'PENDING'` so
  concurrent deliveries cannot both apply.
- **PaymentIntents are idempotency-keyed by transfer id**, so a retried completion reuses the
  existing intent instead of charging twice.
- **A partial unique index** on `ownership_transfers(tag_id) WHERE status='PENDING'` is the
  database-side enforcement of "a pending transfer locks release" — two concurrent initiates cannot
  both win.
- **The SUN counter is burned before payment**, so a captured tap cannot be replayed against a
  second completion attempt while the transfer is still pending.
- **New tables revoke the blanket `anon`/`authenticated` grants** that
  `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO anon` (`20260201042342:2411`) would otherwise
  hand them — the exact mechanism behind the S-ISO1 `aes_key_enc` exposure. `SELECT` is kept so RLS
  remains the read gate.
- **`ownership_proofs` holds `salt_enc`** and is owner-read-only; writes are service-role.

---

## ⏳ Outstanding — for Boss

1. **Apply the migrations** (Claude cannot: `op read` of the DB password is blocked by the sandbox
   classifier):
   ```bash
   supabase db push --linked
   ```
   Then regenerate types into **both** copies, stripping the hint tag:
   ```bash
   npx supabase gen types typescript --project-id pmlofthmobglcfkqjtru \
     | sed '/^<claude-code-hint/d' > frontend/src/types/database.types.ts
   cp frontend/src/types/database.types.ts backend/src/types/database.types.ts
   ```

2. **Verify criterion 11 live** once the migration is applied — that
   `public_tag_provenance` leaks no prior owner, current owner or undisclosed field:
   ```sql
   SELECT * FROM public_tag_provenance LIMIT 5;
   ```

3. **Resolve the duplicate "Stripe" 1Password items before wiring token fees.** The vault has
   **three**: two `LOGIN` (`4jjqf5cazuxgjnk23lpwstzqoe`, `sejob6wh6bcjs4eyoimp4ugkk4`) and one
   `API_CREDENTIAL` (`tbocfigu7g5kfogpyuddhwpqgu`). `op://AM_Development/Stripe/...` is ambiguous
   across them, so backend and frontend can silently resolve to different accounts. The pk/sk pair
   must be same-account (Every-Session lesson, Critical). **Claude could not read the values to
   check — the sandbox classifier blocks secret reads, correctly.**

4. **Create the three new secrets** (references already committed in `backend/.env.op`):
   ```bash
   openssl rand -base64 32 | op item create --category=password \
     --title='Ownership Salt Key' --vault=AM_Development 'key[password]=-'
   openssl rand -base64 32 | op item create --category=password \
     --title='Security' --vault=AM_Development 'log-hmac-key[password]=-'
   ```
   `OWNERSHIP_SALT_KEY` **must be backed up before any real claim in production** — losing it means
   no owner can ever re-download their Receipt.

5. **Register the Stripe webhook endpoint** (sandbox first, per the locked sandbox-in-staging
   pattern): `POST /api/v1/webhooks/stripe-token-fees`, event `payment_intent.succeeded`. Copy the
   `whsec_...` into `op://AM_Development/Stripe/token-fee-webhook-secret`, then set the **literal**
   value on App Runner (env vars there do not resolve `op://`).

6. **Confirm CAD presentment on the sandbox account** — the open question behind Deviation 3. If
   available, set `FEATURE_CAD_PRESENTMENT=true` and `USD_CAD_RATE`; if not, CAD stays deferred.

7. **Push the branch** — `git push` is permission-denied in Claude sessions:
   ```bash
   git push -u origin feature/s-nfc3-tag-management
   ```

---

## Files changed

**New (backend):** `lib/security/securityEvent.ts` · `lib/security/requestContext.ts` ·
`lib/security/twoFactorGate.ts` · `lib/ownership/ownershipProof.ts` · `lib/tokenFees.ts` ·
`controllers/tagManagementController.ts` · `controllers/ownershipController.ts` ·
`routes/tagManagement.ts` · `routes/tokenFeeWebhook.ts` ·
`services/nfc/tagManagementSchemas.ts` · `services/nfc/sunVerification.ts`

**New (tests):** `__tests__/securityEvent.test.ts` · `__tests__/ownershipProof.test.ts` ·
`__tests__/tokenFees.test.ts` · `__tests__/tagManagementRoutes.test.ts` ·
`__tests__/tagLifecycle.test.ts` · `__tests__/tokenFeeWebhook.test.ts` ·
`__tests__/helpers/supabaseMock.ts` · `__tests__/helpers/securityEvents.ts`

**New (migrations):** `20260919000001_nfc_lifecycle_enum.sql` ·
`20260919000002_nfc_tag_management.sql`

**Modified:** `backend/src/app.ts` (two new mounts, one raw) · `backend/src/routes/nfc.ts` ·
`backend/.env.op` · `docs/S_NFC3_VERIFICATION.md`

---

## Next

**S-NFC3.5 — real AN12196 SDM.** No physical chip may be encoded for customers until it ships: the
SUN crypto exercised here is the S-NFC2 codec, not the production SDM scheme.

**S-2FA — MFA enrollment + AAL2 step-up** remains a hard gate before `FEATURE_REQUIRE_2FA` can be
turned on in production.


---

## v1.1 — post-review fix (2026-10-01)

Found during Notion close-out by reading `database.types.ts` directly. **Neither bug was
catchable by the suite as written:** a PostgREST `.select()` string is opaque to TypeScript, and
the hand-rolled Supabase mock answers happily for a column that does not exist. tsc was at 0
errors and 247 tests were passing with both bugs present.

| Bug | Impact |
|---|---|
| `public_tag_provenance` selected `c.username` | **There is no `users.username`** — renamed to `display_name` project-wide on 2026-05-09 (CLAUDE.md v25.0). `CREATE VIEW` would have aborted and taken the whole `20260919000002` migration with it. |
| `billingCountryFor` selected `users.country` | No such column on that table. Failed silently to `null`, so the CAD presentment path had nothing to read. Now reads a new nullable `users.billing_country` (CHECK `^[A-Z]{2}$`). |

Third time this class has bitten the project — the same rename caused 12 broken references in
v25.0.

**Guard added:** `backend/src/__tests__/schemaColumnDrift.test.ts` parses the literal
`.from()`/`.select()` chains in the S-NFC3 modules and asserts every column exists in
`database.types.ts`. Proven to fire: injecting `users.country` fails it, removing it passes. Its
exemption list also records that the committed types file is **still behind S-NFC1.5**
(`fee_payer`, `lifecycle_status`, `linked_item_id`); those entries should disappear at the next
regen rather than be kept.

> ⚠️ **STAGED, NOT COMMITTED.** `git commit` failed with
> `1Password: failed to fill whole buffer` — the SSH agent used for commit signing had locked.
> Unlock 1Password, then commit using the message at
> `scratchpad/s-nfc3-fix-commit-msg.txt`. All five files are staged; nothing is lost.
