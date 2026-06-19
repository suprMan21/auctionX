# Tag HQ — NTAG 424 DNA Read-Only Diagnostic Console (S-NFC1)

Hardware bring-up + acceptance-inspection station. Scans physical chips on the
**ACR1252U**, proves they are **genuine NXP NTAG 424 DNA silicon**, runs a full
read-only diagnostic, and catalogs every tag with a per-tag **FIT / NOT-FIT**
verdict for AM-SEALED. Runs **before** the encoder (S-NFC2) ever writes a key.

> **Read-only, hard line.** Zero write/encode APDUs are possible — every command
> passes a `(CLA, INS)` whitelist (`transport.py` → `apdu.ALLOWED`). No key
> material is ever read, logged, or stored — only key **VERSION** bytes.

## Quick start

```bash
cd tag-hq
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m pytest -q          # 51 tests incl. the gating AN12196 self-test
python run.py                # → http://127.0.0.1:8728  (loopback only)
```

Plug in the ACR1252U, place one tag on the antenna, click **SCAN TAG**.

## What it checks (full diagnostic coverage)

| Area | Detail |
|------|--------|
| **Activation / RF** | ATR, reader UID/ATS, **Random-ID detect** (4-byte `08…`) |
| **Identity** | GetVersion (3-part), asserted against the **NTAG 424 DNA stable tuple** — HW type `0x04` + storage `0x11` + SW sub-type `0x02` + protocol `0x05` (DR-9: *not* the brittle HW sub-type nibble; the old `0x08` "Gx" byte was AN12196's strong-back-modulation example, genuine plain stock returns `0x02`) |
| **Genuineness (§3)** | `Read_Sig` → 56-byte ECDSA over **secp224r1**, raw 7-byte UID (no hash), verified vs the published AN12196 NXP key. Verdict = **"genuine NXP silicon"** |
| **File structure** | Capability Container + NDEF (URI extract, SDM-mirror heuristic), write-lock state |
| **Key config** | 5 key VERSIONS (0–4), default-vs-changed → **ship-state** (factory-default = unpersonalized) |
| **SDM / SUN** | GetFileSettings SDM flag per file + NDEF mirror parameters |
| **Crypto mode** | AES (LRP only observable post-personalization) |
| **Verdict** | FIT requires genuine NXP **and** a match on the NTAG 424 DNA reference tuple (and a real, non-random UID). Possible-TagTamper is an **advisory flag**, not a FIT blocker (definitive Tx exclusion = authenticated GetTTStatus, an S-NFC2 encode gate); off-reference silicon → NOT FIT spec-mismatch |

## Scope boundaries (locked decisions)

- **Genuineness ≠ anti-clone.** A passing ECDSA verify proves the `(UID, sig)`
  pair was *issued by NXP*, not that the die is uncloned. The anti-clone moat is
  the scan-time **SUN/SDM CMAC** on the `/t` endpoint (separate mechanism). The
  verdict deliberately never says "authentic" or "uncloned".
- **Tx is rejected hardware.** AM-SEALED is locked to **plain NTAG 424 DNA +
  frangible antenna** — physical tamper-evidence only (peeling severs the antenna
  and kills the chip), no reliance on an electronic tamper byte. Tag HQ **detects
  and flags** a possible-TagTamper (advisory) or off-reference silicon as a spec
  mismatch; it does **not** build the authenticated GetTTStatus path (that's an
  S-NFC2 encode gate). DR-9 (2026-06-19) confirmed the received supplier stock IS
  the correct part — genuine plain NTAG 424 DNA — and that the prior "Gx = 0x08"
  premise was our error, not a stock defect.

Sources: Decisions DB `3843…17ad` (originality params), `3843…fe47` (Gx/frangible,
**amended by** `3843…0a59` / DR-9), analysis `3843…94be`; spec `3843…296e`. Built
from primary NXP material (AN12196 Rev 2.0, NT4H2421Gx Rev 3.0).

## Module map (reusable — S-NFC2 harvests these)

```
tag_hq/
  transport.py    PC-SC reader I/O + READ-ONLY command whitelist (enforcement point)
  apdu.py         named C-APDU constants for the allowed read set (no write opcodes exist here)
  genuineness.py  §3 ECDSA originality verify + AN12196 Table 30 self-test (LOCKED params)
  parsers.py      GetVersion/Gx · activation · CC · NDEF · FileSettings/SDM · key-version · crypto-mode
  verdict.py      per-tag AM-SEALED FIT / NOT-FIT
  catalog.py      local SQLite, keyed on 7-byte UID hex
  diagnostic.py   orchestrates the full read-only scan into one snapshot
  server.py       FastAPI shell, loopback-only, gated on the self-test
  dashboard/      dark on-brand "TAG HQ" chrome
```

## The gating self-test

The server refuses to start unless the **AN12196 Table 30** vector
(UID `04518DFAA96180`) verifies — if the key/curve/decode wiring is wrong, no
field read can be trusted. It runs as a unit test (`tests/test_genuineness.py`)
and again at server startup (`server.create_app`).

## Verification status (S-NFC1)

- ✅ 51/51 unit tests pass, including the gating self-test, the read-only
  whitelist guard (every write/auth opcode blocked), parsers, verdict, catalog.
- ✅ Server boots, self-test gate passes, dashboard + all API routes serve.
- ✅ Graceful no-reader / no-card paths (HTTP 409) — verified with no hardware.
- ✅ **Live tap done (2026-06-18)** on the ACR1252U against real supplier stock
  (UID `04A27E02936980`). Two findings, both fixed:
  1. Genuine silicon returns Read_Sig status word **`9190`**, not the `9100`
     AN12196 implies — the gate now keys on the ECDSA verify, not the SW (commit
     `1f62316`).
  2. The stock GetVersion HW sub-type is **`0x02`**, not the `0x08` the project
     had assumed — DR-9 re-pinned the FIT check onto the stable tuple (commit
     `d91e76f`). The supplier tag now re-taps **FIT**.

## Rollback

Local-only. To remove: delete `tag-hq/` and drop `tag_hq.db`. No prod/staging/
Supabase/CI impact.
