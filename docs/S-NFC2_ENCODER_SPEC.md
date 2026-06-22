# S-NFC2 — NTAG 424 DNA Encoder Specification (Phase 1: Simulator-Parity)

> **Lane F of S-NFC2.** This is the spec for the tag *encoder* — the station that
> personalizes blank NTAG 424 DNA tags so a tap produces a SUN URL the AuctionX
> backend `validateScan` accepts. It is derived from the existing simulator/verify code
> and the read-only Tag HQ diagnostic station.
>
> Companion docs:
> - `docs/NTAG424_CRYPTO_REFERENCE.md` — PICC layout, AES-CBC, CMAC scheme.
> - `docs/NDEF_MESSAGE_FORMAT.md` — SUN URL template + NDEF byte layout.
>
> **⚠️ Phase 1 is simulator-parity only.** The crypto target is the *simplified* scheme
> in `backend/src/services/nfc/`, NOT full NXP AN12196 SDM. See the
> [Phased Scope](#9-phased-scope) and the Known Gap in the crypto reference. Phase 2
> hardware is **Boss-gated** (§8).

---

## 1. Objective

Build a tag encoder that takes `(tag_uid, baseUrl, tokenName, initial_counter)` plus an
abstractly-provided per-tag AES-128 key, and personalizes a tag (or, in Phase 1, a
simulated tag) so that a subsequent tap emits:

```
{baseUrl}/verify/{tokenName}?picc_data={32 hex}&cmac={16 hex}
```

which `validateScan` (`backend/src/services/nfc/ntag424.ts:116`) validates as genuine
(correct UID, CMAC, strictly-increasing counter).

**Phase 1 produces no hardware writes.** It produces, per tag, the exact PICC ciphertext,
CMAC, NDEF bytes, and SUN URL — verified round-trip against the backend verify logic — so
that the encode pipeline, key management, audit trail, and read-back checks are all
exercised before any silicon is touched.

---

## 2. Hardware (Phase 2 target; recommended, not yet purchased)

- **Recommended reader:** ACR1252U (USB, PC/SC, NFC Forum compliant). PC/SC is the
  transport, so the encoder is **reader-agnostic** — any PC/SC contactless reader that
  passes ISO 14443-4 APDUs works. The ACR1252U is recommended for parity with the Tag HQ
  diagnostic station and broad pyscard support.
- **Transport:** PC/SC, via `pyscard`. APDU conventions match `tag-hq/tag_hq/apdu.py`
  (wrapped-native CLA `0x90`, ISO CLA `0x00`, PC/SC pseudo-APDU CLA `0xFF`).
- **Tags:** genuine plain NTAG 424 DNA. The genuineness acceptance tuple is in
  `tag-hq/tag_hq/parsers.py:18-22`: vendor `0x04`, HW type `0x04`, storage `0x11`,
  protocol `0x05`, SW sub-type `0x02` — plus a passing ECC originality-signature verify.
  Do **not** assert on the HW sub-type nibble (DR-9; `parsers.py:11-17`).

---

## 3. Architecture

```
key provider (AWS KMS today, YubiHSM-2 future)
        │  KeyProvider.derive_tag_key(uid) -> 16B AES-128 key
        ▼
core encoder module  ────────────────►  audit log (who / when / item / UID / counter)
   - build PICC + CMAC + NDEF
   - (Phase 1) emit URL & verify round-trip
   - (Phase 2) drive APDU sequence over PC/SC
   - read-back + verify before "encoded"
        ▲                          ▲
        │ thin CLI (now)           │ 127.0.0.1 FastAPI console (later, Phase 3)
```

- **Language/stack:** Python + `pyscard` (PC/SC), mirroring Tag HQ. Pure, I/O-free crypto
  and byte-building functions (testable without hardware), with a thin transport layer for
  Phase 2.
- **Now:** a small **core module** + a **thin CLI** wrapper. No web server in Phase 1.
- **Later (Phase 3):** a local `127.0.0.1`-bound FastAPI console for an operator UI. Never
  bind to a public interface; the encoder handles key material and audit data.
- **Reuse:** the read-only parsers in `tag-hq/tag_hq/parsers.py` are deliberately
  side-effect-free (`parsers.py:1-5`) and intended for S-NFC2 reuse — use `parse_ndef`,
  `parse_get_version`, `parse_file_settings` for read-back validation. Do **not** import
  the Tag HQ *transport whitelist* (`apdu.py` `ALLOWED`) into the encoder — it is
  deliberately read-only and contains zero write opcodes (`apdu.py:38-52`). The encoder
  needs write opcodes and therefore must define its own, separate command set.

---

## 4. KeyProvider abstraction

The encoder never holds a master key on disk or in memory. Per-tag keys are derived
behind an abstract interface so the backing HSM can be swapped without touching the
encoder.

```python
from typing import Protocol

class KeyProvider(Protocol):
    def derive_tag_key(self, tag_uid: bytes) -> bytes:
        """Return a 16-byte AES-128 key for this tag UID.

        Deterministic: the same UID always yields the same key (so the backend can
        re-derive / store and the encoder can re-encode). The key is derived inside
        the HSM/KMS boundary; no master key is ever exported to the encoder process.
        """
        ...
```

- **Phase 1 / today:** an `KmsKeyProvider` backed by **AWS KMS** — e.g. a deterministic
  derivation (HMAC/KDF) performed via a KMS key, or KMS-`GenerateDataKey`-style derivation
  keyed by UID. The 16-byte AES-128 key it returns is what feeds
  `encryptPiccData` / `computeCmac` (see crypto reference §2–4).
- **Future swap-in:** `YubiHsm2KeyProvider` implementing the same `Protocol`. No encoder
  code changes.
- **Hard rule:** **NO master key on disk or in process memory.** The provider boundary is
  the HSM/KMS; only the per-tag 16-byte derived key transits the encoder, only for the
  duration of one encode, and is zeroized after.
- **Determinism requirement:** `derive_tag_key` must be deterministic so the backend can
  independently obtain the same key (the verify path stores `storedAesKey` per tag,
  `ntag424.ts:117`). UID → key must be reproducible.

---

## 5. Per-tag encode APDU sequence (Phase 2)

The hardware encode sequence (Phase 2; Phase 1 simulates each step's *result*):

1. **SELECT NDEF application** — ISO SELECT by DF name `D2760000850101`
   (cf. `apdu.py:57`, `SELECT_NDEF_APP`).
2. **AuthenticateEV2First** — AES authenticate with the current key (factory default key
   on a virgin tag; factory key version is `0x00`, `parsers.py:269`). Establishes the
   secure session.
3. **ChangeKey** — change the relevant application key(s) to the per-tag key from
   `KeyProvider.derive_tag_key(uid)`. (Opcode `0xC4`; explicitly *absent* from the
   read-only Tag HQ set, `apdu.py:43`.)
4. **ChangeFileSettings (SDM)** — on the NDEF file (`0x02` / `E104`), enable SDM/SUN
   mirroring and set the PICCData + CMAC mirror offsets so a tap appends
   `?picc_data=…&cmac=…`. (Opcode `0x5F`; SDM flag is FileOption bit 6, decoded by
   `parse_file_settings`, `parsers.py:243-258`.) The encoder writes the URL template; the
   chip fills the mirrors at tap time.
   > Phase-1 caveat: the *simplified* CMAC scheme (crypto reference §4) is what the
   > backend validates today. Real silicon SDM emits AN12196 SDMMAC. Aligning the two is
   > the Phase-2 crypto task (crypto reference, Known Gap).
5. **WriteData NDEF** — write the NLEN-wrapped URI record (NDEF layout in
   `NDEF_MESSAGE_FORMAT.md` §2). (Opcode `0x8D`.)
6. **Read-back** — re-SELECT + ISO READ BINARY the NDEF file and run `parse_ndef`
   (`parsers.py:200`) and `parse_file_settings` to confirm the written URL, NLEN, and
   that SDM is enabled. Optionally GetVersion (`parse_get_version`) to re-confirm UID and
   genuineness tuple.

Only after a successful read-back is the tag recorded as **encoded** (§6).

---

## 6. Security constraints

- **Audit log (mandatory):** every encode writes an immutable audit record:
  *who* (operator identity), *when* (timestamp), *which item* (`tokenName` / listing id),
  *which tag UID*, and the resulting counter. No key material in the log.
- **Read-back required before "encoded":** a tag is never marked encoded until the
  post-write read-back (§5 step 6) confirms the on-tag NDEF/URL/SDM match the intended
  values. Phase 1 enforces the analogous round-trip: the produced `picc_data`/`cmac` must
  pass `validateScan` before the encode is recorded.
- **No master key on disk or in memory** — see §4. Only per-tag derived keys, zeroized
  after use.
- **Deterministic, reproducible keying** so verify-side can independently re-derive.
- **Local-only console** (Phase 3) bound to `127.0.0.1`.
- **Encoder ≠ diagnostic station:** the encoder's write opcodes must NOT be added to the
  Tag HQ `ALLOWED` whitelist — keep the read-only station read-only.

---

## 7. Acceptance criteria

**Phase 1 (simulator-parity) — DONE when:**

1. Given `(uid, baseUrl, tokenName, counter)` and a `KeyProvider`, the encoder produces a
   `picc_data` (32 hex) + `cmac` (16 hex) + full SUN URL identical to `simulateTap`
   (`ntag424Simulator.ts:55`) for the same inputs.
2. The produced URL passes `validateScan` (`ntag424.ts:116`) with the matching stored key,
   UID, and a `lastCounter` below the encoded counter (`valid: true`).
3. The produced NDEF bytes parse cleanly via `parse_ndef` (`parsers.py:200`):
   NLEN correct, URI exact, `is_sdm_mirror == True`.
4. `KeyProvider` is wired to AWS KMS; no master key is present on disk or in process
   memory; per-tag keys are zeroized after use.
5. Every simulated encode emits a complete audit record (who/when/item/UID/counter).
6. Unit tests cover the crypto + NDEF byte-building without hardware.

**Phase 2 gate criteria** are Boss-owned (§8) and out of scope for Lane F's deliverable.

---

## 8. Phase-2 hardware gate (Boss-owned)

Phase 2 (writing real silicon) is **not** entered on engineering's say-so. The gate is
Boss-owned and, per DR-9, requires:

- A **GetTTStatus `0xF7` test** to positively distinguish plain NTAG 424 DNA from the
  TagTamper (Tx) variant. The read-only station can only flag "possible TT" from the HW
  sub-type nibble (`parsers.py:82-98`); a definitive answer needs an authenticated
  GetTTStatus, which is outside the read-only station's scope. Confirmed Tx hardware is
  rejected.
- A confirmed **supplier order code** for the correct plain part (per DR-9), so encoded
  stock is provably genuine, plain NTAG 424 DNA matching the acceptance tuple
  (`parsers.py:18-22`) with a passing ECC originality-signature verify.

Until both are satisfied by Boss, the encoder stays in Phase 1 (simulator-parity).

---

## 9. Phased scope

| Phase | Scope | Crypto target | Gate |
|---|---|---|---|
| **1** | Sim-only: core module + thin CLI; produce + round-trip-verify PICC/CMAC/NDEF/URL against the backend; KMS `KeyProvider`; audit log. **No hardware.** | Simplified simulator-parity scheme (crypto reference §4). | — |
| **2** | Real hardware: PC/SC encode APDU sequence (§5) on genuine plain NTAG 424 DNA. Requires aligning **both** encoder and backend `validateScan` to true **AN12196 SDM** session-CMAC. | True NXP AN12196 SDM/SUN (crypto reference, Known Gap). | **Boss-owned** (§8): GetTTStatus `0xF7` + supplier order code (DR-9). |
| **3** | Local `127.0.0.1` FastAPI operator console over the core module. YubiHSM-2 `KeyProvider` swap-in. | (inherits Phase 2) | — |

---

## 10. Source references

| Concern | File:line |
|---|---|
| PICC encrypt / tap simulation | `backend/src/services/nfc/ntag424Simulator.ts:8,30,55` |
| PICC decrypt / CMAC / validateScan | `backend/src/services/nfc/ntag424.ts:26,53,106,116` |
| NDEF parse + URI prefixes | `tag-hq/tag_hq/parsers.py:200,194` |
| File settings / SDM flag | `tag-hq/tag_hq/parsers.py:243` |
| GetVersion / genuineness tuple | `tag-hq/tag_hq/parsers.py:18,51` |
| APDU conventions / read-only whitelist | `tag-hq/tag_hq/apdu.py:16,41,57` |
