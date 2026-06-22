# SIM_PARITY — what this encoder is (and is NOT) in Phase 1

> **Phase 1 of S-NFC2 targets SIMULATOR PARITY, not genuine NXP silicon.**
> Read this before trusting any output against a real NTAG 424 DNA tap.

## The simplified scheme (Phase 1)

The backend simulator (`backend/src/services/nfc/ntag424Simulator.ts`) and the
backend verifier (`backend/src/services/nfc/ntag424.ts`) implement a
**deliberately simplified** SUN scheme. This encoder reproduces it **byte for
byte** so encoder ↔ simulator ↔ backend agree end-to-end with no hardware:

| Field    | Phase-1 (this encoder + simulator + backend)                                   |
|----------|---------------------------------------------------------------------------------|
| PICC pt  | `0xC7 ‖ UID(7B) ‖ counter(3B little-endian) ‖ 0x00·5`  (16 bytes)               |
| Encrypt  | AES-128-**CBC**, **zero IV** (16 null bytes), per-tag 16-byte key → 32 hex chars |
| CMAC     | AES-128-CMAC (RFC 4493) over the **encrypted PICC bytes**, truncated to **8 B**  |
| SUN URL  | `{base}/verify/{encodeURIComponent(token)}?picc_data=<hex>&cmac=<hex>`          |
| NDEF     | URI record, prefix 0x04 (`https://`), wrapped `NLEN(2B big-endian) ‖ message`   |

The parity is locked by `tests/test_parity.py` against golden vectors in
`tests/golden_vectors.json`, which were generated **directly from the
simulator's TypeScript logic** under Node 22.

## Why this is NOT real silicon

Genuine NTAG 424 DNA (NXP AN12196 SDM) differs in two load-bearing ways:

1. **Session-key CMAC.** Real chips derive a **per-tap SDM session key**
   (`SesSDMFileReadMACKey` / ENC key) from the file-read key + the
   `SDMReadCtr` via an AES-CMAC KDF, then compute the **SDMMAC** under that
   session key. This encoder/simulator instead CMACs the **encrypted PICC
   block** under the **static per-tag key**. Different input, different key
   derivation.
2. **MAC input.** Real silicon MACs the **cleartext mirror inputs** (the
   ASCII-mirrored UID/CTR in the URL), not the encrypted PICCData blob.

Therefore a SUN minted here will **not** validate on genuine silicon's own
verify path, and vice-versa — until Phase 2.

## Phase 2 (real silicon) — what must change, on BOTH sides

When real tags enter the loop, align the encoder **and** the backend verifier
together (do not let one drift):

- Implement the AN12196 **AuthenticateEV2First** handshake (session keys
  `SesAuthENCKey` / `SesAuthMACKey`) — the live-channel steps in
  `tag_encoder/ntag424/apdu.py` (currently raising `RequiresLiveChannel`).
- Implement **SDM session-key derivation** (`SesSDMFileReadMACKey` from
  `KSDMFileReadMAC` + `SDMReadCtr`) and compute the **SDMMAC** per AN12196.
- Switch `ChangeFileSettings` to write the real SDM template offsets so the
  chip mirrors UID + `SDMReadCtr` + `SDMMAC` into the URL.
- Update the backend `ntag424.ts` verifier to the same SDM session CMAC.

Until that lands, treat all output here as **simulator-grade**.

## What requires a live secure channel (Phase 2 — currently stubbed)

`tag_encoder/ntag424/apdu.py` builds spec-correct command *structures*, but the
four secure-messaging commands raise `RequiresLiveChannel` because they need a
live EV2 session (encrypt + CMAC under session keys with a command counter):

- `AuthenticateEV2First` mutual-auth response (part 2 framing only)
- `ChangeKey` (0xC4)
- `ChangeFileSettings` (0x5F)
- `WriteData` (0x8D) on a MACed/Full file (a Plain-mode write is framed by
  `write_data_plain` for factory-default tags)

`--dry-run` prints these as cleartext bodies + notes so the full flow is
inspectable offline.
