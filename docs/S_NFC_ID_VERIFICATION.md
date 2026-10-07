# S-NFC-ID — Per-chip serial identity (KDF v2) + K1/K4 · Verification

**Branch:** `feature/s-nfc-id-kdf-v2` (fast-forwarded into `dev`, commit `e6827f8`)
**Date:** 2026-10-06 / 07
**Decision:** Decisions DB `3f13baf6…2c9b` (Locked 2026-10-07, rationale corrected — see §Correction)

## Correction first

S-NFC-ID was started to fix "two NTAG 424 chips reporting one UID" (S-ADMIN1, 2026-10-05). **That finding was
wrong.** S-ADMIN1 compared UIDs by their last six hex characters (`…936980`), which is all the admin console
and logs show. The read-only survey on 2026-10-07 read the FULL UID of five chips from the batch:

| Label | Full UID | Read_Sig SHA-256 | NXP originality | Keys |
|---|---|---|---|---|
| chip_001 | `04 A2 7E 02 93 69 80` | `1d22f42aa70e…` | genuine | v1 (K1/K4 factory) |
| chip_002 | `04 92 7E 02 93 69 80` | `1d38f63b73db…` | genuine | v2 (all five) |
| S03 | `04 8A 7D 02 93 69 80` | `4f85de453506…` | genuine | factory |
| S04 | `04 93 7E 02 93 69 80` | `852eab91fbc9…` | genuine | factory |
| S05 | `04 8A 7E 02 93 69 80` | `bcbb2153ad67…` | genuine | factory |

Five chips, five different UIDs that share a suffix (neighbouring dies from one lot). The "different NXP
signatures" evidence was expected: NXP signs the UID, so different UIDs give different signatures. The encoder
ledger shows no `already_registered` refusal ever happened; that step was inferred, not observed. S-ADMIN1's
"blank twin" (fp `f9f96eb8…`) is one of the five unsurveyed chips. **No supplier issue.**

chip_001's surveyed fingerprint matches the S-ADMIN1 table, so those hashes were computed the same way.

**Why v2 stays (Boss, 2026-10-07):** it is defence in depth, not a fix for a breach. Identity no longer
depends on supplier UID uniqueness, every key slot is ours, the serial is MAC-covered, and each chip's
physical fingerprint is recorded. Clone resistance was already strong and is unchanged.

## What shipped

- **Shared vectors** (`test-vectors/`, OpenSSL oracle): KDF v2 (`… || UID || serial(8)` for per-chip roles at
  version ≥ 2), APP_KEY1/APP_KEY4, and two v2 SDM chain vectors on one UID with different serials. All v1
  vectors byte-identical to before.
- **URL:** `{base}/verify/{token}?sn=<16 hex>&picc_data=<32 hex>&cmac=<16 hex>`. SDMMACInputOffset = start of
  the serial, so the MAC covers `<SN>&picc_data=<ENC>&cmac=`.
- **Encoder** (default `--key-version 2`): identify → gate → originality (+ fingerprint) → key state K0..K4 →
  serial (read back off the chip if any key is already ours) → precheck (serial + fingerprint) →
  unauthenticated pre-write of the template (factory file 02 is Write=E) → AuthEV2First(factory) →
  ChangeFileSettings → ChangeKey K1, K2, K3, K4 → K0 last → NDEF under new K0 → read-back → enroll.
- **Backend:** serial-first tap lookup using the row's own `sdm_key_version` (no App Runner env change);
  v1 lookups restricted to `chip_serial IS NULL`; claim/transfer serial-aware; enroll/precheck accept
  `chipSerial` / `sigSha256` / `sdmKeyVersion`; admin DTO `serialSuffix`.
- **Migration** `20261006000001_s_nfc_id_chip_serial.sql` (applied to staging 2026-10-06): `chip_serial`,
  `originality_sig_sha256` (unique, write-once, frozen when retired), v2 ⇔ serial check, UID unique for v1
  rows only.
- **Frontend:** strips `sn` after a tap; admin chip labels `…936980 · sn …3928`. Deployed by Boss.
- **tag-hq `survey.py`:** read-only UID + fingerprint census (`--label X` one-chip mode). CSV outside the repo.

## Test results

```
tag-encoder  pytest      210 passed   (was 166; +test_personalise_v2.py)
tag-hq       pytest       71 passed   (was 68; +test_survey.py)
backend      tsc          0 errors
backend      vitest      498 passed · 21 skipped   (was 457; +chipIdentity.test.ts, v2 vectors)
frontend     tsc          0 errors
frontend     vitest      100 passed
frontend     eslint      3 pre-existing problems in admin pages (identical without this branch)
```

One unrelated Stripe webhook test failed once mid-session and passed on every rerun (see the S-NFC3-FE
"1 in ~45 runs" note in TODO).

## Live on staging

| Check | Result |
|---|---|
| Migration applied, recorded remotely | ✅ `20261006000001` |
| Backend deploy | ✅ SUCCEEDED 2026-10-06 01:51 EDT |
| `chip_002` encoded v2 on real silicon | ✅ tag `346aee56…`, serial `85B5BF9D81903928`, all five keys v2, read-back verified |
| `chip_002` phone tap | ✅ opens chip_002 (counter → 5) |
| `chip_001` (v1) phone tap after v2 deploy | ✅ opens chip_001 (counter 28 → 31), chip_002 untouched |

First encode attempt failed at **enroll**: Boss encoded at 01:47, the deploy started 01:46 and finished
01:51, so the old backend rejected `chipSerial`. The chip was fully personalised; re-running resumed with the
same serial and enrolled. **Wait for App Runner `SUCCEEDED` before encoding against a changed API.**

## Bugs found on the way

- **Emulator MAC order:** the software chip computed the SDMMAC before mirroring PICCData into the file.
  Silicon mirrors first (AN12196: the MAC input contains the mirrored ENCPICCData). v1 hid it (empty input).
- **Test mock:** `maybeSingle()` returned the first of several rows; PostgREST errors. Fixed, so an ambiguous
  UID lookup can't pass silently.

## Open / next session

- **S-ADMIN1 physical reset test:** encode S03 as `chip_003`, claim `chip_002` with a test account, reset
  `chip_002` → `chip_003` in the admin console, tap both. Do NOT retire `chip_001` (first chip, paid-transfer
  history).
- **Idea:** staging-only "recycle test chip" (factory keys back + `RECYCLED` status, never delete rows) —
  needs a staging-only exception to the Locked never-reuse rule. Build only if test chips run short.
- Backfill `chip_001.originality_sig_sha256` (`1d22f42a…` full value in `~/.am-tag-hq/survey-20261007.csv`) — optional.
