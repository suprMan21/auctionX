# tag-encoder — NTAG 424 DNA encoder core + CLI (S-NFC2, Lane A)

The **write** counterpart to the read-only [`tag-hq`](../tag-hq) diagnostic
station. Produces NTAG 424 DNA **SUN** (Secure Unique NFC) payloads for
Authentic Materials tags.

> **Phase 1 is SIM-ONLY.** Output is byte-identical to the backend simulator
> (`backend/src/services/nfc/ntag424Simulator.ts`) and validates through the
> backend verifier logic (`ntag424.ts`) — **no hardware in the loop**. This is
> **not** genuine NXP AN12196 SDM session-CMAC yet. **Read [`SIM_PARITY.md`](./SIM_PARITY.md).**

## Layout

```
tag_encoder/
├── aes.py              # pure-Python AES-128 (ECB/CBC/CMAC) — zero runtime deps
├── ndef.py             # NDEF URI record BUILDER (round-trips tag_hq.parsers)
├── keyprovider.py      # KeyProvider Protocol + LocalStubKeyProvider (per-UID KDF)
├── cli.py              # encode / read / verify  (dry-run is fully offline)
└── ntag424/
    ├── encode.py       # pure encode pipeline (SIM parity) + decrypt mirror
    └── apdu.py         # write/encode C-APDU builder (AN12196 EV2)
tests/                  # pytest: aes KATs, key determinism, parity, ndef, apdu, cli
```

`providers/` is **owned by a separate agent** (the AWS-KMS `KeyProvider`
backend) — not created here.

## Crypto / format contract (fixed)

- PICC plaintext (16B): `0xC7 ‖ UID(7B) ‖ counter(3B LE) ‖ 0x00·5`
- Encrypt: AES-128-CBC, zero IV, per-tag 16-byte key → uppercase hex (32 chars)
- CMAC: AES-128-CMAC (RFC 4493) over the **encrypted PICC bytes**, truncated to
  8 bytes → uppercase hex (16 chars)
- SUN URL: `{base}/verify/{token}?picc_data=<hex>&cmac=<hex>`
- NDEF: URI record, prefix `0x04` (`https://`), `NLEN(2B big-endian) ‖ message`

## Key provider

```python
from typing import Protocol
class KeyProvider(Protocol):
    def derive_tag_key(self, tag_uid: bytes) -> bytes:  # 7B in -> 16B AES key, deterministic
        ...
```

`LocalStubKeyProvider` derives `K_tag = AES-CMAC(root, "AM-NTAG424-KDF\x01" ‖ UID)`
— deterministic, **distinct per UID**, never a single reused master key. The
production AWS-KMS backend implements the same Protocol under `providers/`.

## CLI

```bash
# Encode a SUN for an item (JSON output)
python -m tag_encoder.cli encode --item item_123 --counter 0

# Dry-run: prints the full AN12196 APDU sequence + SUN URL, touches no reader
python -m tag_encoder.cli encode --item item_123 --dry-run

# Read an NDEF file image back to its URI (round-trips the builder)
python -m tag_encoder.cli read --ndef 003BD1013755...

# Verify a PICC+CMAC against the backend's validateScan logic
python -m tag_encoder.cli verify --uid 04A27E02936980 --key <32hex> \
    --picc <32hex> --cmac <16hex> --last-counter -1
```

> Any future local server (Phase 3) **must bind to 127.0.0.1 only**. No server
> ships in Phase 1.

## Tests

```bash
cd tag-encoder
python -m pytest          # zero runtime deps; pytest only
```

Coverage: FIPS-197/RFC-4493 AES & CMAC known-answer vectors, key-derivation
determinism + per-UID uniqueness, **simulator parity** (golden vectors pulled
from the TS simulator), NDEF round-trip through `tag_hq.parsers`, APDU wire
vectors + Phase-2 guardrails, and CLI encode/read/verify.
```
