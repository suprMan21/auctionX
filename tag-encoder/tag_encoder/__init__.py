"""Tag Encoder — NTAG 424 DNA encoder core + CLI.

The WRITE counterpart to the read-only `tag-hq` diagnostic station.
S-NFC3.5: implements real NXP AN12196 SDM (AES mode), byte-identical to the
backend verifier and pinned to the shared OpenSSL vectors in
`test-vectors/ntag424_sdm_vectors.json`. Live EV2 secure-channel writes remain
S-NFC2 Phase 2.

Modules:
    aes             self-contained pure-Python AES-128 (ECB/CBC/CMAC), zero deps
    ndef            NDEF URI record BUILDER (round-trips tag_hq.parsers.parse_ndef)
    keyprovider     KDF spec + KeyProvider Protocol + LocalKeyProvider (SDM + ADMIN roots)
    ntag424.encode  AN12196 SDM encode/verify + SDM NDEF template/offsets
    ntag424.apdu    personalisation C-APDU builder (AN12196 EV2) + SDM file settings
    cli             encode / read / verify (no command prints key material)
"""

__version__ = "0.2.0"
