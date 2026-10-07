# tag-encoder — NTAG 424 DNA encoder core + CLI

The **write** counterpart to the read-only [`tag-hq`](../tag-hq) diagnostic
station. Produces NTAG 424 DNA **SUN** (Secure Unique NFC) payloads for
Authentic Materials tags.

> **S-NFC3.5 (2026-10-01): real NXP AN12196 SDM.** Encoder, backend verifier
> and Tag HQ parser are aligned and pinned to one OpenSSL-generated vector file
> (`../test-vectors/ntag424_sdm_vectors.json`). The Phase-1 simplified CMAC is
> deleted — see [`SIM_PARITY.md`](./SIM_PARITY.md) and
> [`docs/NTAG424_CRYPTO_REFERENCE.md`](../docs/NTAG424_CRYPTO_REFERENCE.md).
>
> **S-NFC2 Phase 2 (2026-10-02): physical encode.** EV2 secure messaging
> (`ntag424/session.py`) is pinned byte-for-byte to NXP AN12196's worked
> examples (auth, session keys, MAC/Full modes, both ChangeKey cases). The
> `personalise` command keys a real chip, reads it back, verifies the SUN, and
> only then enrolls it. Ph2 also fixed a byte-swapped `SDMAccessRights` from
> S-NFC3.5 (`23 FF` → `FF 23`) before any chip was written.

## Layout

```
tag_encoder/
├── aes.py              # pure-Python AES-128 (ECB/CBC enc+dec, CMAC) — zero runtime deps
├── ndef.py             # NDEF URI record BUILDER (round-trips tag_hq.parsers)
├── keyprovider.py      # KDF spec + KeyProvider Protocol + LocalKeyProvider (two roots)
├── cli.py              # encode / read / verify / personalise / tapcheck
├── personalise.py      # the 9-stage physical encode (gate → precheck → key → read-back → enroll)
├── transport.py        # PC/SC (pyscard); separate from tag-hq's read-only transport
├── registry.py         # backend precheck + enroll (staff JWT); MemoryRegistry for rehearsal
├── audit.py            # append-only JSONL ledger, field allowlist (no UID / URL / keys)
└── ntag424/
    ├── encode.py       # AN12196 SDM: PICCData, SV2 session MAC, even-byte truncation, NDEF template
    ├── apdu.py         # personalisation C-APDU builder, SDM file settings, GetKeyVersion
    ├── session.py      # EV2 secure messaging (AuthenticateEV2First, MAC/Full, ChangeKey)
    └── emulator.py     # software NTAG 424 DNA for rehearsal + tests (never for customer chips)
iam/                    # encoder IAM role/trust/user policies (MFA-gated KMS GenerateMac)
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

## Physical encode (S-NFC2 Phase 2)

### What `personalise` does to each chip

Default is key version 2 (S-NFC-ID, 2026-10-06): a per-chip serial in the URL (`?sn=`) and in the keys,
all five key slots set. `--key-version 1` keeps the old UID-only flow.

| # | Stage | Writes? | Refuses / fails when |
|---|---|---|---|
| 1 | identify: GetVersion | no | not the AM-SEALED acceptance tuple, non-NXP UID |
| 2 | gate: GetTTStatus `0xF7` | no | command exists → TagTamper (Locked: rejected) |
| 3 | originality: Read_Sig + NXP P-224 verify; SHA-256 of Read_Sig = fingerprint | no | signature does not verify |
| 4 | key state: GetKeyVersion K0..K4 | no | a version that is neither factory (0) nor ours |
| 5 | serial: read back off the NDEF, else 8 random bytes | no | a key is already ours but no serial is on the chip |
| 6 | registry precheck (staff API, serial + fingerprint) | no | this chip or serial exists; **RETIRED is never reused**; backend unreachable (fails closed) |
| 7 | pre-write: WriteData template with the serial, unauthenticated (factory file is Write=E) | yes | serial does not read back |
| 8 | Auth K0 (factory) → ChangeFileSettings → ChangeKey K1, K2, K3, K4 → ChangeKey **K0 last** | yes | any SW / MAC error (re-run resumes) |
| 9 | Auth K0 (new) → WriteData NDEF template | yes | new K0 rejected |
| 10 | read-back: GetFileSettings + ReadBinary; the SUN must verify under the derived keys | no | settings or NDEF differ, SUN invalid |
| 11 | enroll (staff API) → `ENROLLED` | DB | API error (chip is fine; re-run resumes and enrolls) |

No blockchain write (G5). An abort at any point is safe to re-run on the same chip: the serial is on the
chip before any key depends on it, K0 changes last, and GetKeyVersion tells the encoder which old key each
slot holds. **After an API change, wait for the App Runner deploy to report SUCCEEDED before encoding**
(2026-10-06: an encode mid-deploy failed at enroll and had to be resumed).

To census a batch without writing anything, use `tag-hq/survey.py` (full UID + fingerprint per chip).
Compare FULL UIDs — the console's 6-character suffix is shared by neighbouring chips from one lot.

### One-time setup (Boss, AWS console, ~10 min)

1. IAM **role** `am-tag-encoder-staging`: permissions = `iam/am-tag-encoder-staging.role-policy.json`
   (GenerateMac + DescribeKey on both tag keys); trust = `iam/am-tag-encoder-staging.trust-policy.json`
   (only user `am-tag-encoder`, only with MFA ≤ 1 h old).
2. IAM **user** `am-tag-encoder`: inline policy `iam/am-tag-encoder.user-policy.json` (AssumeRole
   into that role, nothing else), a virtual **MFA device**, one access key (store in 1Password).
3. `~/.aws/config` on the encoding Mac:
   ```ini
   [profile am-encoder-user]
   region = us-east-2
   [profile am-encoder]
   role_arn = arn:aws:iam::904183418667:role/am-tag-encoder-staging
   source_profile = am-encoder-user
   mfa_serial = arn:aws:iam::904183418667:mfa/am-tag-encoder
   region = us-east-2
   ```
   plus the user's access key under `[am-encoder-user]` in `~/.aws/credentials`. boto3 asks for the
   MFA code once per run. Every derivation shows up in CloudTrail as `GenerateMac` by the role.
4. Fill the staff-login item names in `encoder.env.op`.

### Encoding

```bash
cd tag-encoder
python3 -m venv .venv && .venv/bin/pip install -e '.[hardware]'

# Rehearse first: software chip, in-memory registry, nothing leaves the Mac
.venv/bin/python -m tag_encoder.cli personalise --item rehearsal --emulator --dev-roots

# One real chip (prompts to place it; MFA prompt once)
op run --env-file encoder.env.op -- .venv/bin/python -m tag_encoder.cli personalise --item <id>

# A lot: CSV with an `item` column (optional `token`), one chip per row
op run --env-file encoder.env.op -- .venv/bin/python -m tag_encoder.cli personalise --batch lot.csv
```

`--item` that is an `items.id` UUID is linked at enroll; anything else is an
audit label only. Chips keyed under the staging KMS roots point at the staging
frontend by default (`--base-url` to override).

### Phone-tap end-to-end

Tap the chip with a phone, copy the URL it opens, then:

```bash
.venv/bin/python -m tag_encoder.cli tapcheck --url '<the URL>'   # POST /api/v1/nfc/scan → HTTP 200
```

### Audit ledger

`~/.am-tag-encoder/audit.jsonl` (mode 0600, append-only): who, when, item,
token, tag id, outcome + closed-set reason, stage, key version, read-back
counter. Never the UID, URL, PICCData, CMAC or any key; the tag id resolves to
the UID in the registry. The backend's `nfc.enroll` security event is the
server-side record.

## Tests

```bash
cd tag-encoder
python -m pytest          # pytest only; runs tests/ AND providers/
```
