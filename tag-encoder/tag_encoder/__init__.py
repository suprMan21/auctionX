"""Tag Encoder — NTAG 424 DNA encoder core + CLI (S-NFC2, Lane A).

The WRITE counterpart to the read-only `tag-hq` diagnostic station. Phase 1 is
SIM-ONLY: it produces byte-identical SUN output to the backend simulator
(`backend/src/services/nfc/ntag424Simulator.ts`) and validates through the
backend verifier logic — no hardware in the loop.

Modules:
    aes          self-contained pure-Python AES-128 (ECB/CBC/CMAC), zero deps
    ndef         NDEF URI record BUILDER (round-trips tag_hq.parsers.parse_ndef)
    keyprovider  KeyProvider Protocol + LocalStubKeyProvider (per-UID KDF)
    ntag424.encode  pure encode pipeline (SIM parity) + decrypt mirror
    ntag424.apdu    write/encode C-APDU builder (AN12196 EV2)
    cli          encode / read / verify commands (dry-run is fully offline)

SEE SIM_PARITY.md: Phase 1 targets SIMULATOR parity, NOT genuine AN12196 SDM
session-CMAC. Phase 2 (real silicon) must realign encoder AND backend.
"""

__version__ = "0.1.0"
