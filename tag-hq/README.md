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
python -m pytest -q          # 45 tests incl. the gating AN12196 self-test
python run.py                # → http://127.0.0.1:8728  (loopback only)
```

Plug in the ACR1252U, place one tag on the antenna, click **SCAN TAG**.

## What it checks (full diagnostic coverage)

| Area | Detail |
|------|--------|
| **Activation / RF** | ATR, reader UID/ATS, **Random-ID detect** (4-byte `08…`) |
| **Identity** | GetVersion (3-part), asserted against the locked **Gx** reference `0404083000110504040201011105` |
| **Genuineness (§3)** | `Read_Sig` → 56-byte ECDSA over **secp224r1**, raw 7-byte UID (no hash), verified vs the published AN12196 NXP key. Verdict = **"genuine NXP silicon"** |
| **File structure** | Capability Container + NDEF (URI extract, SDM-mirror heuristic), write-lock state |
| **Key config** | 5 key VERSIONS (0–4), default-vs-changed → **ship-state** (factory-default = unpersonalized) |
| **SDM / SUN** | GetFileSettings SDM flag per file + NDEF mirror parameters |
| **Crypto mode** | AES (LRP only observable post-personalization) |
| **Verdict** | FIT requires genuine NXP **and** Gx variant; Tx/off-spec → NOT FIT spec-mismatch |

## Scope boundaries (locked decisions)

- **Genuineness ≠ anti-clone.** A passing ECDSA verify proves the `(UID, sig)`
  pair was *issued by NXP*, not that the die is uncloned. The anti-clone moat is
  the scan-time **SUN/SDM CMAC** on the `/t` endpoint (separate mechanism). The
  verdict deliberately never says "authentic" or "uncloned".
- **Tx is rejected hardware.** AM-SEALED is locked to **Gx + frangible antenna**.
  Gx has **no electronic tamper byte** — physical tamper-evidence only (peeling
  severs the antenna and kills the chip). Tag HQ **detects and flags** Tx/off-spec
  as a spec mismatch; it does **not** build the authenticated GetTTStatus path.

Sources: Decisions DB `3843…17ad` (originality params), `3843…fe47` (Gx/frangible);
spec `3843…296e`. Built from primary NXP material (AN12196 Rev 2.0, NT4H2421Gx Rev 3.0).

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

- ✅ 45/45 unit tests pass, including the gating self-test, the read-only
  whitelist guard (every write/auth opcode blocked), parsers, verdict, catalog.
- ✅ Server boots, self-test gate passes, dashboard + all API routes serve.
- ✅ Graceful no-reader / no-card paths (HTTP 409) — verified with no hardware.
- ⏳ **Live tap pending**: the field read of a physical Gx tag on the ACR1252U is
  the one thing that needs the reader + a real tag. The ACR1252U response-length
  handling for the 56-byte Read_Sig reply is verify-on-first-tag (fallback noted
  in the spec if the reader truncates).

## Rollback

Local-only. To remove: delete `tag-hq/` and drop `tag_hq.db`. No prod/staging/
Supabase/CI impact.
