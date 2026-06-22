# Tag Encoder — Key-Derivation Providers (S-NFC2, Lane B)

Per-tag AES-128 key derivation for the NTAG 424 DNA encoder. The encoder core
selects a provider that satisfies the `KeyProvider` Protocol and calls
`derive_tag_key(tag_uid: bytes) -> bytes` (7-byte UID in, 16-byte AES-128 key
out, deterministic for a given UID + root).

```python
from typing import Protocol
class KeyProvider(Protocol):
    def derive_tag_key(self, tag_uid: bytes) -> bytes: ...
```

## Security model (non-negotiable, per the S-NFC2 brief)

- **No master AES key on disk or in tool memory.** The keying root lives only
  inside AWS KMS as a non-exportable HMAC CMK.
- Per-tag derivation calls `kms:GenerateMac` with the tag UID as the message;
  KMS computes `HMAC_SHA_256(root, uid)` server-side inside the HSM boundary.
- The 32-byte MAC is run through one **HKDF-Expand** step (RFC 5869,
  HMAC-SHA-256, stdlib only — no `cryptography` dependency) to produce the
  16-byte AES-128 key bound to a stable `info` label. Only the derived key is
  returned; it lives only for the call's lifetime (encoder core zeroizes after
  use). The intermediate MAC buffer is best-effort wiped.
- Every derivation is **audit-logged** (principal, timestamp via logging, tag
  UID, key alias, region) on logger `tag_encoder.providers.kms.audit`. **Key
  material is never logged.** AWS CloudTrail independently records every
  `GenerateMac` call signed by the execution role.

## Required KMS key

- A **KMS HMAC key**: `KeySpec = HMAC_256`, `KeyUsage = GENERATE_VERIFY_MAC`.
- Alias **`alias/am-tag-root`** (the project's key root for tag derivation).
- Region **`us-east-2`** (the project's AWS region).

Create once (admin, out of band):

```bash
KEY_ID=$(aws kms create-key --region us-east-2 \
  --key-spec HMAC_256 --key-usage GENERATE_VERIFY_MAC \
  --description "AM NTAG424 per-tag key-derivation root" \
  --query KeyMetadata.KeyId --output text)
aws kms create-alias --region us-east-2 \
  --alias-name alias/am-tag-root --target-key-id "$KEY_ID"
```

## Required IAM

Scoped to the CMK ARN, the encoder's execution role needs:

```json
{
  "Effect": "Allow",
  "Action": ["kms:GenerateMac", "kms:DescribeKey"],
  "Resource": "arn:aws:kms:us-east-2:<acct>:key/<key-id>"
}
```

- `kms:GenerateMac` — the derivation call (every tag).
- `kms:DescribeKey` — startup validation (`validate_on_init=True` /
  `validate_key()`) that the key is an enabled `HMAC_256 / GENERATE_VERIFY_MAC`
  key, so a misconfigured key fails closed.

> If you instead implement an encrypt-based KDF variant, swap `kms:GenerateMac`
> for `kms:Encrypt`. This module uses **GenerateMac** (cleaner: KMS *is* the
> HMAC PRF, no plaintext-vs-ciphertext determinism caveats).

## Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `AM_TAG_ROOT_KEY_ALIAS` | `alias/am-tag-root` | KMS key id/alias |
| `AWS_REGION` | `us-east-2` | KMS region |
| `AM_TAG_ENCODER_PRINCIPAL` | `unknown` | audit-trail identity hint (real attribution is in CloudTrail) |

Plus standard AWS credential resolution (role / `AWS_PROFILE` / env keys).

## How the encoder selects this provider

The provider is the production backend. A local dev stub (separate module owned
by the encoder core, e.g. `LocalDevKeyProvider`) satisfies the same Protocol for
offline work and **must never** be used to encode real tags. Suggested wiring:

```python
import os
if os.environ.get("AM_TAG_KEY_PROVIDER", "kms") == "kms":
    from providers import KmsKeyProvider
    provider = KmsKeyProvider(validate_on_init=True)   # real KMS, us-east-2
else:
    from <encoder-core> import LocalDevKeyProvider      # dev stub, NEVER for prod
    provider = LocalDevKeyProvider()
```

`KmsKeyProvider` accepts an injected `kms_client=` (a boto3 client or any object
exposing `generate_mac`/`describe_key`) — used by the unit tests to run fully
offline (no real AWS, no `moto` required).

## Future backend: YubiHSM 2 (deferred)

The S-NFC2 brief defers a **physically-sovereign HSM** backend behind this same
`KeyProvider` Protocol. A `YubiHsmKeyProvider` will:

- Hold the derivation root inside a YubiHSM 2 (PKCS#11 / `yubihsm-shell`),
  computing `HMAC-SHA-256(root, uid)` on-device, then the identical HKDF-Expand
  step — so a tag's derived key is **identical** whether produced via KMS or the
  YubiHSM (same root value provisioned to both during migration).
- Require **no encoder-core changes**: same `derive_tag_key(bytes) -> bytes`
  contract, same 16-byte output, same audit-logging discipline (no key material
  logged).

This lets the project move from cloud-custodied (KMS + CloudTrail) to
physically-sovereign custody without re-encoding the installed tag base.

## Tests

```bash
python3 tag-encoder/providers/test_kms_key_provider.py     # standalone, no deps
# or
python3 -m pytest tag-encoder/providers/test_kms_key_provider.py
```

Covers: 16-byte output; 7-byte UID enforcement; non-bytes rejection;
determinism (same UID→same key, across instances, across roots); KMS receives
the raw UID; **no >=16-byte key constant at module level**; provider instance
holds no `bytes` secret; audit log emitted without key material; `validate_key`
accepts good / rejects wrong-spec & disabled keys. All offline via an injected
KMS stub.
