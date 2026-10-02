"""Tag Encoder — NTAG 424 DNA encoder core + CLI.

The WRITE counterpart to the read-only `tag-hq` diagnostic station.
S-NFC3.5: implements real NXP AN12196 SDM (AES mode), byte-identical to the
backend verifier and pinned to the shared OpenSSL vectors in
`test-vectors/ntag424_sdm_vectors.json`. S-NFC2 Phase 2: live EV2 secure
messaging (pinned to NXP AN12196 worked examples) and physical personalisation.

Modules:
    aes             self-contained pure-Python AES-128 (ECB/CBC/CMAC), zero deps
    ndef            NDEF URI record BUILDER (round-trips tag_hq.parsers.parse_ndef)
    keyprovider     KDF spec + KeyProvider Protocol + LocalKeyProvider (SDM + ADMIN roots)
    ntag424.encode  AN12196 SDM encode/verify + SDM NDEF template/offsets
    ntag424.apdu    personalisation C-APDU builder (AN12196 EV2) + SDM file settings
    ntag424.session EV2 secure messaging: AuthenticateEV2First, CommMode.MAC/Full, ChangeKey
    ntag424.emulator software NTAG 424 DNA for rehearsal + tests (never for customer chips)
    transport       PC/SC (pyscard) card I/O, separate from tag-hq's read-only transport
    registry        backend precheck (RETIRED never reused) + enroll; staff JWT
    audit           append-only JSONL ledger (no UID / URL / key material)
    personalise     the 9-stage physical encode, read-back verified before enroll
    cli             encode / read / verify / personalise (no command prints key material)
"""

__version__ = "0.3.0"
