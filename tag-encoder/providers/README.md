# Tag Encoder — Key Providers (S-NFC3.5)

Role-aware chip-key derivation for the NTAG 424 DNA encoder. Every provider
satisfies `tag_encoder.keyprovider.KeyProvider`:

```python
class KeyProvider(Protocol):
    def derive_key(self, role: str, version: int, uid: bytes | None = None) -> bytes: ...
```

Roles: `META` (fleet SDMMetaReadKey, no UID), `FILE` (per-UID SDMFileReadKey),
`APP_MASTER` (per-UID application master key). Output: 16-byte AES-128 key,
deterministic for (root, role, version, uid). Spec and byte layout:
`docs/NTAG424_CRYPTO_REFERENCE.md` §2.

## Two roots, by role (amended 2026-10-01 by Boss)

KMS cannot restrict `GenerateMac` by message content, so role separation is
root separation:

| Root | Staging alias | Roles | Who may call it |
|---|---|---|---|
| SDM | `alias/am-tag-sdm-staging` | META, FILE | backend + encoder |
| ADMIN | `alias/am-tag-admin-staging` | APP_MASTER | **encoder only** |

Production gets its own `-prod` pair at launch; staging and prod never share
roots. Both keys: Symmetric, *Generate and verify MAC*, `HMAC_256`.

## KmsKeyProvider

- Sends the public KDF message to `kms:GenerateMac` (HMAC_SHA_256) on the
  role's root, then HKDF-Expand → 16 bytes. Roots never leave KMS.
- No caching; the intermediate MAC buffer is wiped.
- Audit log (`tag_encoder.providers.kms.audit`): role, version, key ref,
  region, principal — never key material, MAC or UID.
- **Never creates, aliases or imports a key** (grep-guarded by
  `tests/test_no_kms_key_creation.py` and the backend `nfcKeyGuards.test.ts`).
  Key creation is a one-time Boss action documented in
  `docs/S_NFC3_5_VERIFICATION.md`.

Environment:

| Var | Default |
|---|---|
| `AM_TAG_SDM_KEY_ID` | `alias/am-tag-sdm-staging` |
| `AM_TAG_ADMIN_KEY_ID` | `alias/am-tag-admin-staging` |
| `AWS_REGION` | `us-east-2` |
| `AM_TAG_ENCODER_PRINCIPAL` | `unknown` |

IAM for the **encoder** role: `kms:GenerateMac` + `kms:DescribeKey` on BOTH key
ARNs. The **backend** role gets the SDM key ARN only.

## LocalKeyProvider (staging / offline)

`tag_encoder.keyprovider.LocalKeyProvider(sdm_root, admin_root, allow_local_keys=True)`
— two 32-byte roots, must differ, refuses to construct without the explicit
opt-in. Produces exactly the KMS provider's keys for the same root bytes
(tested). Never for customer chips.

## Tests

```bash
cd tag-encoder && python -m pytest      # providers/ is in testpaths
```

`providers/test_kms_key_provider.py`: OpenSSL KDF vectors for all three roles
through an injected KMS stub (no network), role→root routing, KMS == local,
no caching, short-MAC rejection, audit-log redaction, `validate_keys`, no
secret bytes on the instance or module.
