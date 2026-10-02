# tag-encoder — NTAG 424 DNA encoder core + CLI

The **write** counterpart to the read-only [`tag-hq`](../tag-hq) diagnostic
station. Produces NTAG 424 DNA **SUN** (Secure Unique NFC) payloads for
Authentic Materials tags.

> **S-NFC3.5 (2026-10-01): real NXP AN12196 SDM.** Encoder, backend verifier
> and Tag HQ parser are aligned and pinned to one OpenSSL-generated vector file
> (`../test-vectors/ntag424_sdm_vectors.json`). The Phase-1 simplified CMAC is
> deleted — see [`SIM_PARITY.md`](./SIM_PARITY.md) and
> [`docs/NTAG424_CRYPTO_REFERENCE.md`](../docs/NTAG424_CRYPTO_REFERENCE.md).
> Live EV2 secure-channel writes are still S-NFC2 Phase 2: **no physical chip
> may be encoded for customers until that ships.**

## Layout

```
tag_encoder/
├── aes.py              # pure-Python AES-128 (ECB/CBC enc+dec, CMAC) — zero runtime deps
├── ndef.py             # NDEF URI record BUILDER (round-trips tag_hq.parsers)
├── keyprovider.py      # KDF spec + KeyProvider Protocol + LocalKeyProvider (two roots)
├── cli.py              # encode / read / verify (dry-run is fully offline)
└── ntag424/
    ├── encode.py       # AN12196 SDM: PICCData, SV2 session MAC, even-byte truncation, NDEF template
    └── apdu.py         # personalisation C-APDU builder (AN12196 EV2), SDM file settings
providers/
└── kms_key_provider.py # KmsKeyProvider — SDM root + ADMIN root (KMS GenerateMac)
tests/                  # pytest (shared OpenSSL vectors, KDF, apdu layout, cli, guards)
```

## Crypto / format contract

- `ENCPICCData = AES-128-CBC(SDMMetaReadKey, IV 0, PICCDataTag ‖ UID ‖ ctr(3 LE) ‖ pad(5))`
- `SDMMAC = CMAC(CMAC(SDMFileReadKey, 3CC300010080 ‖ UID ‖ ctr), MAC input)`,
  truncated to the even-numbered bytes; MAC input empty in our layout
- URL: `{base}/verify/{token}?picc_data=<32 hex>&cmac=<16 hex>`
- Key slots: K0 APP_MASTER (ADMIN root), K2 META (SDM root, fleet), K3 FILE (SDM root, per UID)

## Keys

Derived, never stored or printed: `HMAC-SHA256(root, msg)` → HKDF-Expand (see
`keyprovider.py`). Two roots by role — SDM (`alias/am-tag-sdm-staging`) and
ADMIN (`alias/am-tag-admin-staging`). See [`providers/README.md`](./providers/README.md).

## CLI

```bash
# Encode (simulated tap) — roots from env (staging) …
NFC_LOCAL_SDM_ROOT_KEY=<64hex> NFC_LOCAL_ADMIN_ROOT_KEY=<64hex> NFC_ALLOW_LOCAL_KEYS=true \
  python -m tag_encoder.cli encode --item item_123 --counter 1
# … or PUBLIC dev roots for an offline demo (never for a customer chip)
python -m tag_encoder.cli encode --item item_123 --dry-run --dev-roots

# Read an NDEF file image back to its URI
python -m tag_encoder.cli read --ndef 003BD1013755...

# Verify exactly as the backend does (replay_detected / invalid_signature / uid_mismatch)
python -m tag_encoder.cli verify --uid 04A27E02936980 --picc <32hex> --cmac <16hex> --last-counter 0 --dev-roots
```

No command prints key material. Any future local server **must bind to
127.0.0.1 only**.

## Tests

```bash
cd tag-encoder
python -m pytest          # pytest only; runs tests/ AND providers/
```
