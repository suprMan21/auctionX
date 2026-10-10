# Encoder auto-naming — verification

**Date:** 2026-10-10 · **Branch:** `dev` (`fd27020`, `beb3363`, `d32de33`) · **Decision:** Locked 2026-10-09
(next `chip_NNN`, uniqueness checked on the backend before any chip write).

## Status

| Part | State |
|------|-------|
| Name reserved on the backend before the first chip write | ✅ live on staging, verified on silicon (manual name) |
| Manual name goes through the same check | ✅ verified on silicon (`chip_`, 05:15Z) |
| No name → next `chip_NNN` | ⚠️ tests + live DB check only. **Not yet run on a real chip** (Boss is saving sample chips) |
| `chip_` prefix reserved for the sequence | ✅ live in the staging database; backend message needs the next push + deploy |
| Chip name in the admin console | ✅ backend live; frontend deployed by Boss 2026-10-10 |

## What was built

The backend stored no chip name before this: `chip_004` existed only in the chip's URL path and the encoder's local
audit ledger.

- **Migration `20261010000001`:** `nfc_tags.chip_name` (unique ignoring case, write-once), table `nfc_chip_names`
  (every name ever handed out; never reused, even after a chip is retired), `reserve_chip_name()` (atomic under an
  advisory lock; idempotent per chip fingerprint), a trigger that refuses an enroll whose name is not reserved for that
  chip, backfill of `chip_001`–`chip_004` from the audit ledger.
- **Migration `20261010000002`:** a manual name starting with `chip_` (any case) is refused unless it is exactly the
  next name in sequence.
- **Backend:** `POST /api/v1/nfc/enroll/reserve-name` (`manage_nfc`); enroll accepts `chipName`; admin tag list,
  detail and re-issue queue return `chipName`.
- **Encoder:** the name is reserved at the registry stage (stage 6), before the pre-write. No `--item`/`--token` → the
  backend picks the next `chip_NNN`. A clash, a bad name or a backend outage refuses the chip with nothing written.
  A chip that failed mid-encode gets the same name on the re-run.
- **Frontend:** the chip label leads with the name (`chip_004 · …936980 · sn …0351DE`).

## Tests

| Suite | Result |
|-------|--------|
| tag-encoder | 244 passed (was 210) |
| tag-hq | 71 passed |
| backend vitest | 569 passed / 21 skipped (was 556) |
| frontend vitest | 132 passed |
| tsc backend + frontend | 0 errors |
| Live DB check `supabase/tests/chip_names_live.sql` (rolled back) | 17/17 |

Not covered: two encoders racing against the real database. The advisory lock is in the function; the live check
runs in one session.

## Live run (staging)

| Step | Time (UTC) | Result |
|------|-----------|--------|
| Migration `20261010000001` applied (only one pending) | ~04:55 | ✅ live check 15/15 |
| Push to `dev`, App Runner deployment | 05:04:15 → 05:08:03 | ✅ SUCCEEDED; `reserve-name` 404 → 401 |
| Boss encodes a blank chip | 05:15:16–17 | ✅ `nfc_chip_name_reserved`, then `nfc.enroll` ok; tag `ea8dfb62-bb19-4795-9a7a-86b78ca6568d` |
| Phone tap (test2@) | 05:15:40 | ✅ `nfc.sun_verify` ok |
| Migration `20261010000002` applied | later | ✅ live check 17/17 |

**Finding:** the chip was reported as `chip_005`, but the backend log (`"chip_name":"chip_","auto":false`), the audit
ledger and the database all say it is named `chip_`: a name was passed on the command line. So the manual path is
proven on silicon and the auto path is not. The name is write-once, so that chip stays `chip_`. This is what the
reserved-prefix migration closes.

## Chips after this session

`chip_001` (v1, ACTIVE, test2@), `chip_004` (v2, ACTIVE, test2@), `chip_` (v2, enrolled 2026-10-10),
`chip_002` and `chip_003` RETIRED (destruction PENDING). Next auto name: `chip_005`.

## Open

- Run the auto path on silicon the next time a chip is needed anyway: `personalise` with no `--item` and no `--token`;
  expect `item=(auto)` and `✓ ENCODED  chip_005`.
- Free check of the reserved prefix (uses no chip, nothing is written): put a blank on the reader and run
  `personalise --item chip_`; expect `REFUSED (nothing written)`.
- Boss: push `dev` (`d32de33` + this doc) and confirm the backend deploy, so the refusal carries its clear message.
