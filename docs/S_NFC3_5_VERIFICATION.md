# S-NFC3.5 — Real AN12196 SDM Crypto Realignment · Verification

**Branch:** `feature/s-nfc3.5-sdm` (base: local `dev` @ `6e9da64`, contains S-DB1)
**Date:** 2026-10-01
**Scope:** replace the S-NFC2 simplified CMAC with real NXP AN12196 SDM (AES mode) in the
Python encoder, the TS backend and the Tag HQ parser **together**. Out of scope: LRP, physical
encode over a live EV2 channel (S-NFC2 Ph2), mobile, frontend.

> **No physical chip may be encoded for customers yet** — S-NFC2 Phase 2 (live secure channel)
> still has to land on top of this crypto. Nothing here was pushed, merged, `db push`ed, or
> run against AWS.

---

## Test results

| Suite | Command | Before | After |
|---|---|---|---|
| backend types | `cd backend && npx tsc --noEmit` | 0 errors | **0 errors** |
| backend tests | `cd backend && npx vitest run` | 16 files · 252 passed · 21 skipped | **19 files · 362 passed · 21 skipped** |
| frontend types | `cd frontend && npx tsc --noEmit` | 0 errors | **0 errors** |
| tag-encoder | `cd tag-encoder && pytest` | 51 passed (providers/ NOT collected — 14 more only when run by path) | **131 passed** (incl. 24 in `providers/`) |
| tag-hq | `cd tag-hq && pytest` | 51 passed | **67 passed** |
| boundaries | `npm run lint:boundaries` | ✔ 0 violations (121 modules, 292 deps) | **✔ 0 violations (127 modules, 329 deps)** — non-zero module count, not a false green |

**No new skips** (21 → 21, all pre-existing). The worktree has no `backend/.env`, so both the
baseline and the final backend run used throwaway env values
(`SUPABASE_URL=https://example.supabase.co SUPABASE_SERVICE_ROLE_KEY=x SUPABASE_ANON_KEY=x`);
without them `routeAllowlist`/`tagManagementRoutes`/`auctions` fail at import exactly as they do
on the base commit. Python ran in a scratch venv (pytest 9.1.1, Python 3.14).

| Spec file | Tests | Covers |
|---|---|---|
| `backend/src/__tests__/ntag424Sdm.test.ts` (new; replaces `ntag424Codec.test.ts`, 16 tests, deleted) | 50 | AN12196 golden vector every intermediate; all shared SDM vectors (decrypt + encode side); every flipped MAC byte; PICCDataTag vectors; RFC 4493 KATs incl. empty message; MAC-input range; constant-time compare (spy on `timingSafeEqual`); local provider → simulator → `validateSunScan` over the KDF chain vectors; replay / flipped MAC / Tag-A-as-Tag-B / spliced MAC / wrong root / wrong version |
| `nfcKeyProvider.test.ts` (new) | 51 | KDF message/info + keys vs OpenSSL for local AND KMS (mock client); KMS == local; no caching; `kms.op GenerateMac` with no UID/key/root/PRK; generic error on KMS failure; short-MAC rejection; backend refuses `APP_MASTER` (local + KMS, no KMS call made); request validation; Zod config defaults / opt-in / non-echoing errors |
| `nfcKeyGuards.test.ts` (new) | 6 | grep: no CreateKey/CreateAlias/ImportKeyMaterial across backend/src, backend/scripts, tag-encoder, tag-hq; backend never references the admin alias/config; `aes_key_enc` never read/written; no `select('*')` on nfc_tags |
| `sdmKeyHygiene.test.ts` (new) | 8 | public `/nfc/scan`: single-META-decrypt identification, replay, flipped MAC, Tag-A-with-Tag-B UID, unknown, version mismatch, race; plus the **full-flow key hygiene** test |
| `tagLifecycle.test.ts` (updated) | 37 → 47 | renamed codes; flipped MAC nibbles; Tag-A URL as Tag-B; claim race; completion replay; other-chip URL on completion; completion race; enroll refuses key material and stores no key |
| `schemaColumnDrift.test.ts` (updated) | 5 → 6 | now also checks `nfcController.ts`; embedded-resource selects stripped before checking |
| `tag-encoder/tests/test_sdm_vectors.py` (new) | 52 | shared vectors: golden, every intermediate, encode side, flipped bytes, MAC range, PICCDataTag, all 16 KDF vectors (both roots), KDF chain, `verify_sun` error codes |
| `tag-encoder/providers/test_kms_key_provider.py` (rewritten, now collected by plain `pytest`) | 24 | KDF vectors via KMS stub, role→root routing, KMS == local, no caching, audit-log redaction, `validate_keys`, no secret bytes |
| `tag-encoder/tests/test_keyprovider.py` (rewritten) | 15 | opt-in refusal, two distinct 32-byte roots, APP_MASTER only from ADMIN root, determinism, bad requests |
| `tag-encoder/tests/test_cli.py` (rewritten) | 9 | roots required; encode / dry-run / verify output contains **no root or derived key**; replay / bad MAC / UID mismatch |
| `tag-encoder/tests/test_sdm_template.py` (new) | 3 | SDM offsets hit the placeholders; chip mirror reads back as the SUN URL; **Tag HQ parses exactly what the encoder writes** |
| `tag-encoder/tests/test_apdu.py` (updated) | 16 | exact ChangeFileSettings bytes; plain-mirror (0x0E) rejected; access-right packing; slot map; K0 changed last; no key bytes in the sequence |
| `tag-encoder/tests/test_no_kms_key_creation.py` (new) | 2 | Python mirror of the CreateKey grep |
| `tag-hq/tests/test_sdm_parsing.py` (new) | 16 | PICCDataTag from shared vectors; encrypted / plain / ENCFileData+CtrLimit / MAC-off / truncated SDM blocks |

---

## Acceptance criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Encoder and backend reproduce the AN12196 vector byte for byte, every intermediate | ✅ | Backend `ntag424Sdm.test.ts` › "AN12196 golden vector #1" (6 specs: PICCData `C704DE5F1EACC0403D0000DA5CF60941`, UID/ctr 61, SV2, `KSesSDMFileReadMAC = 3FB5F6E3A807A03D5E3570ACE393776F`, CMAC `E194C7EE12D9F7EE8A65C8331B704386`, truncated `94EED9EE65337086`). Encoder `test_sdm_vectors.py` › `test_golden_*`. Re-confirmed with openssl directly this session (`openssl enc -d -aes-128-cbc … -nopad` → `C704DE5F…0941`; `openssl mac -cipher AES-128-CBC -macopt hexkey:00…00 CMAC` over SV2 → `3FB5F6E3…776F`; over empty input with that key → `E194C7EE…4386`). The generator also asserts these literals before writing. |
| 2 | Python and TS agree on ONE shared vector file, both load it | ✅ | `test-vectors/ntag424_sdm_vectors.json`, generated by `test-vectors/generate_ntag424_vectors.py` with the **openssl binary** for every AES/CMAC/HMAC/HKDF byte (re-running it is a no-op diff). Loaded by `backend/src/__tests__/helpers/sdmVectors.ts` (vitest), `tag-encoder/tests/test_sdm_vectors.py` + `providers/test_kms_key_provider.py` (pytest), `tag-hq/tests/test_sdm_parsing.py` (pytest). Contents: 5 SDM vectors (golden, non-zero keys, large LE counter, counter 0, non-empty MAC input), 16 KDF vectors (2 roots × META/FILE×2 UIDs/APP_MASTER × v1/v2), 2 KDF→SDM chain vectors, 8 PICCDataTag cases. Old fixtures deleted. |
| 3 | Replayed URL ⇒ `replay_detected` | ✅ | `tagLifecycle` "rejects a replayed SUN", "rejects a second completion with the same tap"; `sdmKeyHygiene` "replayed URL -> replay_detected"; `ntag424Sdm` "replayed URL"; encoder `test_verify_replay_detected`, CLI `test_verify_rejects_replay`. Races: conditional-update zero rows ⇒ `replay_detected` (claim, transfer-complete, scan). |
| 4 | One flipped MAC byte ⇒ `invalid_signature` | ✅ | `tagLifecycle` "rejects one flipped MAC nibble" ×4 + "forged MAC"; `sdmKeyHygiene` "one flipped MAC byte"; `ntag424Sdm` "every single flipped MAC byte fails" (all 8 positions × 5 vectors) and "checked before the counter"; encoder `test_every_flipped_mac_byte_fails`. |
| 5 | Tag-A URL with Tag-B UID fails | ✅ | `tagLifecycle` "rejects a Tag-A URL presented with Tag-B UID" (claim; `sun_result=uid_mismatch`, API `invalid_signature`) and "rejects completion with another chip's URL"; `sdmKeyHygiene` direct-mode scan; `ntag424Sdm` "Tag-A URL with Tag-B UID" + "spliced MAC"; encoder `test_verify_tag_a_url_with_tag_b_uid_fails`, CLI `test_verify_rejects_other_uid`. |
| 6 | No code path creates a KMS key | ✅ | `nfcKeyGuards.test.ts` + `tag-encoder/tests/test_no_kms_key_creation.py` grep for CreateKey / CreateAlias / ImportKeyMaterial / GetParametersForImport (and snake_case) across backend/src, backend/scripts, tag-encoder, tag-hq (>80 files, asserted). Code only calls `GenerateMac` (+ `DescribeKey` in the encoder's `validate_keys`). |
| 7 | No chip key material in DB / logs / files / stdout | ✅ | `sdmKeyHygiene` full flow (scan, replay, stale claim, forged claim, claim, initiate, wrong-chip completion, completion, enroll) captures console log/info/warn/error (logger + security events), every response body and every DB row; asserts none contains the SDM root, META key, either FILE key, or any session MAC key; no row has a key column. `nfcKeyProvider` asserts `kms.op` carries no UID/key/root/PRK. Encoder `test_cli.py` asserts stdout+stderr of encode / dry-run / verify contain neither root nor any derived key. No key is written to any file; `ntag-simulator.ts` no longer prints or seeds keys. |
| 8 | `aes_key_enc` finding documented | ✅ | See "Audit finding: `aes_key_enc`" below. |
| 9 | Simplified-CMAC paths deleted | ✅ | `computeCmac`/`truncateCmac`/`verifyCmac`/`encryptPiccData(uid,ctr,key)`/`validateScan`/`generateAesKey` (TS) and `compute_cmac_hex`/`truncated_cmac_hex`/old `encrypt_picc_data`/`LocalStubKeyProvider` (Py) removed, not flagged off. Guard "first-8-bytes truncation" proves the suites go red if it returns. |
| 10 | All suites green, module count non-zero, no new skips | ✅ | Table above. |
| 11 | Every new guard proven to fire | ✅ | 17/17 — see next section. |

### Guards proven to fire (inject → red → revert → green)

Driver: a scratch script that rewrote one file, ran the guarding test, restored the original
bytes, and re-ran (worktree `git status` clean afterwards).

```
FIRES | KMS CreateKey grep (TS)                | injected: Failed 1        | reverted: 6 passed
FIRES | KMS create_key grep (Python)           | injected: 1 failed        | reverted: 2 passed
FIRES | backend references admin alias         | injected: Failed 1        | reverted: 6 passed
FIRES | aes_key_enc read                       | injected: Failed 1        | reverted: 6 passed
FIRES | select('*') on nfc_tags                | injected: Failed 1        | reverted: 6 passed
FIRES | derived key leaks to a log line        | injected: Failed 1        | reverted: 1 passed
FIRES | CLI prints a key (Python)              | injected: 2 failed        | reverted: 9 passed
FIRES | non-constant-time compare              | injected: Failed 1        | reverted: 1 passed
FIRES | backend can derive APP_MASTER          | injected: Failed 5        | reverted: 5 passed
FIRES | claim counter burn not conditional     | injected: Failed 1        | reverted: 1 passed
FIRES | transfer counter burn not conditional  | injected: Failed 1        | reverted: 1 passed
FIRES | scan counter burn not conditional      | injected: Failed 1        | reverted: 1 passed
FIRES | local provider without opt-in          | injected: Failed 1        | reverted: 1 passed
FIRES | schema drift: bogus nfc_tags column    | injected: Failed 1        | reverted: 6 passed
FIRES | first-8-bytes truncation               | injected: Failed 9        | reverted: 50 passed
FIRES | PICCDataTag accepts uid_len != 7       | injected: 3 failed        | reverted: 52 passed
FIRES | Tag HQ plain-mirror not flagged        | injected: 1 failed        | reverted: 16 passed
```

---

## Renamed / new codes (S-NFC3 tests updated deliberately)

| Where | Before (S-NFC3) | After (S-NFC3.5) |
|---|---|---|
| `nfc.sun_verify.sun_result` | `cmac_invalid` | `invalid_signature` |
| | `counter_replay` | `replay_detected` |
| | `counter_regression` | `replay_detected` (merged — S-SEC0 can still derive regression from `counter < last_counter`, both in the event) |
| | `unknown_tag` (for a UID mismatch) | `uid_mismatch` (new value); `unknown_tag` kept for "no such chip" |
| `SecurityResult` (`nfc.claim` / `nfc.transfer` / `nfc.sun_verify` `result`) | `sun_invalid` for every SUN failure | `replay_detected`, `invalid_signature` (new values); `sun_invalid` kept for malformed input |
| `kms.op.operation` | Encrypt / Decrypt / GenerateDataKey | + `GenerateMac` (purpose `tag_key`) |
| validator error (TS + Py CLI) | free text: "Invalid SUN message format", "Failed to decrypt PICCData", "UID mismatch", "CMAC verification failed", "Counter replay detected" | closed `SdmFailure`: `malformed`, `invalid_signature`, `uid_mismatch`, `invalid_signature`, `replay_detected` |
| API (claim / transfer complete) | 400 `invalid_argument`, generic message | same status/code, plus `reason: "replay_detected" \| "invalid_signature"` (closed set, from `AppError.details`) |
| API (`POST /nfc/scan`) | `{ valid: false }` | `{ valid: false, reason }` (additive) |

S-NFC3 tests changed: `tagLifecycle` replay, regression (renamed to "treats a counter
regression as replay_detected"), forged CMAC (→ invalid_signature), stale SUN on completion,
both enroll specs (no `aesKey`).

---

## Audit finding: `aes_key_enc`

**Finding:** despite its name, `nfc_tags.aes_key_enc` held the per-tag AES-128 key as
**plaintext hex** — nothing encrypted it. It was the single secret the S-NFC2 scheme rested on,
and it was exposed through several paths (one of them — anon PostgREST via RLS — was already
hot-fixed by `20260918000000_fix_nfc_rls_key_exposure.sql`).

Writers on the base commit (`6e9da64`):
- `backend/src/controllers/nfcController.ts` `registerTag` — stored a **client-supplied** `aesKey` (parked route).
- `backend/src/controllers/tagManagementController.ts` `enrollTag` — stored the staff-supplied `aesKey` (`tagManagementSchemas.ts` `enrollSchema`).
- `backend/scripts/ntag-simulator.ts` `seed` — generated a key, stored it, **and printed it to stdout** (`generate` printed one too).

Readers on the base commit:
- `nfcController.scanTag` — selected `aes_key_enc` for up to **500** candidate tags and trial-decrypted against each, then again for the matched row.
- `nfcController.registerTag` — `.insert(...).select()` with no columns **returned the full row, key included, in the HTTP response**.
- `nfcController.getTagVerification` / `getTagByUid` (public) — `select('*')` read the key, then stripped it before responding (one forgotten line from a leak).
- `tagManagementController.claimTag` / `completeTransfer` — selected it for the SUN check.
- `ntag-simulator.ts tap` — selected it.
- `frontend/src/features/verification/pages/NfcDashboardPage.tsx` still has an `aesKey` form field posting to the parked `/nfc/register` (frontend out of scope — see Outstanding).

**After S-NFC3.5:** no backend code reads or writes the column (guard test). Keys are derived
from the KMS root on demand. The register/scan/public responses use explicit column lists.
Migration `20261001000002` relaxes `aes_key_enc` NOT NULL and marks it deprecated.
**Existing values are left untouched** — nulling them is Boss's call.

---

## 🔴 Corrections to the brief

1. **Amended 2026-10-01 by Boss: per-role KMS roots.** The brief's single `alias/am-tag-root`
   is superseded. KMS cannot restrict `GenerateMac` by message content, so role separation must
   be root separation: SDM root `alias/am-tag-sdm-staging` (META + FILE; backend + encoder) and
   ADMIN root `alias/am-tag-admin-staging` (APP_MASTER; **encoder only**). Backend config is
   `NFC_KMS_SDM_KEY_ID` / `NFC_LOCAL_SDM_ROOT_KEY` (op ref `op://AM_Development/NFC Local Root/sdm-key`);
   the backend has no setting, type or code path that can address the admin root, and
   `deriveKey` throws on `APP_MASTER` (tested, guard-proven). The encoder provider takes a
   role→root mapping; its local provider takes two roots.
2. **The old crypto doc was wrong about PICCData.** `NTAG424_CRYPTO_REFERENCE.md` claimed real
   silicon encrypts PICCData under a counter-derived `SesSDMFileReadENCKey`. AN12196 encrypts
   PICCData under the SDMMetaReadKey directly, zero IV; the session ENC key applies only to
   SDMENCFileData. The golden vector confirms it. Doc rewritten.
3. **The old "empty-message CMAC differs from RFC 4493" comment was wrong** (TS and Py). Both
   implementations already matched RFC 4493 §2.4 for the empty message; now pinned by the RFC
   KAT `BB1D6929…6746`. It matters: our SDMMAC *is* a CMAC over the empty string.
4. **`registerTag` leaked the key in its HTTP response** (`.select()` with no columns) — not just
   "stores client aesKey" as the code map said. Fixed with an explicit column list.
5. **tag-encoder's KMS provider tests were never run by `pytest`** (testpaths was `tests` only):
   baseline "51 passed" excluded them. `testpaths = ["tests", "providers"]` now.
6. Line references in the brief's code map had drifted by a few lines; edits were made by
   content, not line number. The crypto reference's stale line refs are all replaced.

## Deviations (conservative choices made without asking)

1. **`counter_regression` merged into `replay_detected`** — the acceptance criterion says a
   replayed URL ⇒ `replay_detected`, and an *older* captured URL is a regression. The
   distinction survives in the event's `counter` / `last_counter`.
2. **New `sun_result` value `uid_mismatch`** (Tag-A URL vs Tag-B) for S-SEC0; API callers see
   `invalid_signature`. Additive enum value.
3. **API reason field:** failure codes reach clients as a closed-set `reason` alongside the
   unchanged `{ success, data, error, code }` envelope (`routes/tagManagement.ts` echoes only
   `replay_detected` / `invalid_signature` from `details`). HTTP 400 unchanged.
4. **MAC is checked before the counter** — a forged MAC on any counter is `invalid_signature`;
   only an authentic tap can be `replay_detected`.
5. **`sdm_key_version` is `SMALLINT DEFAULT 1` (nullable) + CHECK 1..255**; code treats NULL as 1.
6. **Extra config:** `NFC_KMS_REGION` (default `us-east-2`) and `NFC_SDM_KEY_VERSION` (version
   stamped on new enrolments; scan tries current → 1). **`NFC_KEY_PROVIDER` defaults to `kms`**
   (fail closed if unset).
7. **Validation tightened:** enroll `tagUid` must be 14 hex; `registerTagSchema` is `.strict()`
   and has no `aesKey`; enroll `.strict()` now rejects `aesKey` (tested). UIDs are upper-cased
   on enroll/register and on claim lookup (the existing `getTagByUid` convention).
8. **Transfer completion** now also requires the body's `tagUid` to equal the transfer's chip
   (previously it was only compared to the decrypted UID).
9. **Encoder:** CLI needs roots (`NFC_LOCAL_SDM_ROOT_KEY` + `NFC_LOCAL_ADMIN_ROOT_KEY` +
   `NFC_ALLOW_LOCAL_KEYS=true`) or `--dev-roots` (public, worthless constants, stderr warning).
   KMS env vars renamed `AM_TAG_SDM_KEY_ID` / `AM_TAG_ADMIN_KEY_ID`. Audit log no longer
   records the UID. `encode_apdu_sequence` takes no key and prints redacted ChangeKey layouts.
   Version 0.2.0.
10. **SDM settings chosen from the datasheet bit layout** (AccessRights Read=E, Write/RW/Change=K0;
    SDMCtrRet=F; MetaRead=K2; FileRead=K3; CommMode Plain). Not yet confirmed on silicon —
    Phase 2 should read back with Tag HQ (which now decodes these fields).
11. **Tag HQ diagnostic JSON** gains SDM fields (key *slot numbers* and offsets only).
12. **`npm install @aws-sdk/client-kms`** also bumped shared `@aws-sdk/*` transitive versions in
    `package-lock.json` (449-line diff); all suites green.

---

## Security notes

- Derived keys: per-request, wiped (`fill(0)`) after use in TS; never cached, persisted,
  logged, returned or printed. The KMS PRK buffer is wiped in both stacks.
- Roots: KMS roots never leave KMS. The local provider (staging) holds the SDM root in process
  memory only and refuses to construct without `NFC_ALLOW_LOCAL_KEYS=true`. Config errors name
  fields, never values.
- One META key decrypts every chip's PICCData (fleet-wide by design, Locked decision). Its
  compromise reveals UIDs + counters but does **not** allow forging: the MAC needs the per-UID
  FILE key. The admin root (K0) is unreachable from the backend.
- Constant-time MAC comparison in both stacks. The encoder's pure-Python AES is not
  constant-time; it runs only in the operator-attended local encoder.
- Counter: one column (`sun_counter`), every burn conditional (`.lt('sun_counter', n)`), zero
  rows ⇒ replay. Scan no longer trial-decrypts across 500 stored keys.
- Existing staging `aes_key_enc` values remain in the table (plaintext). RLS no longer exposes
  them (S-ISO1 hotfix) and no code reads them, but they are still key material at rest.

---

## ⏳ Boss actions

**(a) Apply the migration** (from your own shell):

```bash
cd unmentionables/Unmen
supabase db push --linked          # applies 20261001000002_nfc_sdm_key_version.sql
supabase gen types typescript --linked > backend/src/types/database.types.ts   # + frontend copy
```

Then remove `nfc_tags: ['sdm_key_version']` from `PENDING_MIGRATION_COLUMNS` in
`backend/src/__tests__/schemaColumnDrift.test.ts`. **Deploy order:** migration before the
backend — enroll/scan/claim select or write `sdm_key_version`.

**(b) KMS — two keys, created in the console** (us-east-2): *Customer managed keys → Create key →
Symmetric → Generate and verify MAC → HMAC_256*.

| Alias | Purpose | Who may use it |
|---|---|---|
| `alias/am-tag-sdm-staging` | SDM root (META + FILE) | backend + encoder |
| `alias/am-tag-admin-staging` | ADMIN root (APP_MASTER) | encoder only |

(CLI equivalent, for reference only — not scripted anywhere in the repo:
`aws kms create-key --key-spec HMAC_256 --key-usage GENERATE_VERIFY_MAC --region us-east-2`,
then `aws kms create-alias --alias-name alias/am-tag-sdm-staging --target-key-id <id> --region us-east-2`;
repeat for the admin key.) Production gets its own `-prod` pair at launch; **staging and prod
never share roots**.

Backend IAM role **`am-backend-staging-instance`**, trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "tasks.apprunner.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
```

Inline policy — **SDM key ARN only**:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "NfcSdmRootGenerateMacOnly",
    "Effect": "Allow",
    "Action": ["kms:GenerateMac", "kms:DescribeKey"],
    "Resource": "arn:aws:kms:us-east-2:<account-id>:key/<sdm-staging-key-id>"
  }]
}
```

⚠️ The App Runner service (`auctionX_backend_staging`) currently has **no instance role**; this
one must be attached at deploy (Configuration → Security → Instance role). The encoder's
operator credentials need the same two actions on **both** key ARNs.

**(c) 1Password + App Runner (staging, until KMS is live):**

```bash
openssl rand -hex 32 | op item create --category=password --vault=AM_Development \
  --title='NFC Local Root' 'sdm-key[password]=-'
# encoder-only second root (never in App Runner):
op item edit 'NFC Local Root' --vault=AM_Development "admin-key[password]=$(openssl rand -hex 32)"
```

App Runner staging env: `NFC_KEY_PROVIDER=local`, `NFC_ALLOW_LOCAL_KEYS=true`,
`NFC_LOCAL_SDM_ROOT_KEY=<sdm-key>`, `NFC_SDM_KEY_VERSION=1`. After KMS: `NFC_KEY_PROVIDER=kms`,
`NFC_KMS_SDM_KEY_ID=alias/am-tag-sdm-staging`, `NFC_ALLOW_LOCAL_KEYS=false`, unset the local
root. `backend/.env.op` already references `op://AM_Development/NFC Local Root/sdm-key`.

**(d) Existing staging tags will not verify.** Every `nfc_tags` row created under the S-NFC2
scheme (random per-tag `aes_key_enc`, plain/simplified CMAC — incl. the S-NFC1 smoke-test UID
`04A27E02936980` if still present) cannot produce or pass AN12196 SDM under derived keys. Scans
of them now return 404 / `invalid_signature`. Re-seed via `ntag-simulator.ts seed` once the
local root is set; decide separately whether to NULL the old `aes_key_enc` values.

## Outstanding / follow-ups

- Frontend `NfcDashboardPage.tsx` still posts `aesKey` to the parked `/nfc/register` (would now
  be a 400 if un-parked). Remove in a frontend session.
- S-NFC2 Phase 2: live EV2 channel for ChangeKey/ChangeFileSettings/WriteData; confirm the SDM
  settings bytes on silicon via Tag HQ read-back.
- Run `notion-librarian` / Notion session-end updates (not done by this executor).

---

## Files changed (vs `6e9da64`)

**New:** `test-vectors/generate_ntag424_vectors.py`, `test-vectors/ntag424_sdm_vectors.json`,
`supabase/migrations/20261001000002_nfc_sdm_key_version.sql`,
`backend/src/services/nfc/keys/{keyDerivation,tagKeyProvider,config}.ts`,
`backend/src/__tests__/{ntag424Sdm,nfcKeyProvider,nfcKeyGuards,sdmKeyHygiene}.test.ts`,
`backend/src/__tests__/helpers/sdmVectors.ts`,
`tag-encoder/tests/{test_sdm_vectors,test_sdm_template,test_no_kms_key_creation}.py`,
`tag-hq/tests/test_sdm_parsing.py`, this doc.

**Rewritten / modified:** backend `ntag424Codec.ts`, `ntag424.ts`, `ntag424Simulator.ts`,
`sunVerification.ts`, `types.ts`, `schemas.ts`, `tagManagementSchemas.ts`,
`controllers/nfcController.ts`, `controllers/tagManagementController.ts`,
`routes/tagManagement.ts`, `lib/security/securityEvent.ts`, `scripts/ntag-simulator.ts`,
`.env.op`, `package.json` (+ lock), tests `tagLifecycle`, `schemaColumnDrift`,
`helpers/supabaseMock`; tag-encoder `aes.py`, `keyprovider.py`, `cli.py`, `ntag424/encode.py`,
`ntag424/apdu.py`, `__init__.py`, `providers/kms_key_provider.py`,
`providers/test_kms_key_provider.py`, `tests/test_{aes,apdu,cli,keyprovider}.py`,
`pyproject.toml`, `README.md`, `SIM_PARITY.md`, `providers/README.md`; tag-hq `parsers.py`,
`diagnostic.py`; `docs/NTAG424_CRYPTO_REFERENCE.md`.

**Deleted:** `backend/src/__tests__/ntag424Codec.test.ts`,
`backend/src/services/nfc/__fixtures__/ntag424_vectors.json`,
`tag-encoder/tests/golden_vectors.json`, `tag-encoder/tests/test_parity.py`.
