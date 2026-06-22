"""AWS-KMS-backed per-tag key-derivation provider for the NTAG 424 DNA encoder.

Lane B of S-NFC2.

SECURITY MODEL (non-negotiable, per the S-NFC2 brief)
-----------------------------------------------------
* There is **no master AES key on disk or in process memory**. The keying
  root lives exclusively inside AWS KMS as a non-exportable HMAC CMK.
* Per-tag key derivation is performed by calling ``kms.generate_mac`` with the
  tag UID as the message. KMS computes ``HMAC_SHA_256(root, uid)`` server-side;
  the root never leaves the HSM boundary.
* The 32-byte MAC returned by KMS is run through one HKDF-Expand step (RFC 5869,
  HMAC-SHA-256) to produce a 16-byte AES-128 key bound to a stable info label.
  The derived key is returned to the caller and is held only for the lifetime of
  the ``derive_tag_key`` call by this provider (the encoder core is responsible
  for zeroizing it after use).
* Every derivation is structured-audit-logged: caller principal (if resolvable),
  timestamp, tag UID, and the key reference (alias). **Key material is never
  logged.**

Determinism
-----------
``generate_mac`` is deterministic for a fixed (CMK, message, MAC algorithm), and
HKDF is deterministic for a fixed (IKM, salt, info, length). Therefore
``derive_tag_key(uid)`` is deterministic for a given UID + root, as the contract
requires.

KMS KEY SPEC EXPECTED
---------------------
* A KMS **HMAC** key (``KeySpec=HMAC_256``, ``KeyUsage=GENERATE_VERIFY_MAC``).
* Reachable via the alias ``alias/am-tag-root`` (override with the
  ``AM_TAG_ROOT_KEY_ALIAS`` env var or the ``key_id`` constructor arg).
* Region: ``us-east-2`` (override with ``AWS_REGION`` / ``key_region`` arg).

IAM
---
The encoder's execution role needs, scoped to the CMK ARN:
    kms:GenerateMac
    kms:DescribeKey      (startup validation of key spec/state)
CloudTrail captures each ``GenerateMac`` call for audit.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
from typing import Any, Optional, Protocol

__all__ = ["KeyProvider", "KmsKeyProvider"]

# Module-wide structured audit logger. Configured by the host application; we
# only emit on it. NOTE: this logger must NEVER receive key material.
audit_log = logging.getLogger("tag_encoder.providers.kms.audit")

# ---------------------------------------------------------------------------
# Interface contract (also re-exported from the package __init__).
# ---------------------------------------------------------------------------


class KeyProvider(Protocol):
    """Structural contract shared with the encoder core."""

    def derive_tag_key(self, tag_uid: bytes) -> bytes:  # pragma: no cover - protocol
        """tag_uid = 7 bytes; returns a 16-byte AES-128 key.

        Deterministic for a given UID + root.
        """
        ...


# ---------------------------------------------------------------------------
# Constants. None of these is key material.
# ---------------------------------------------------------------------------

NTAG424_UID_LEN = 7
AES128_KEY_LEN = 16
DEFAULT_KEY_ALIAS = "alias/am-tag-root"
DEFAULT_REGION = "us-east-2"
KMS_MAC_ALGORITHM = "HMAC_SHA_256"

# HKDF "info" label that domain-separates the derived AES-128 tag key from any
# other use of the same KMS MAC. Stable on purpose -> determinism. This is a
# public constant, not a secret.
_HKDF_INFO = b"NTAG424-DNA/AppKey/AES128/v1"


def _hkdf_expand(ikm: bytes, info: bytes, length: int) -> bytes:
    """RFC 5869 HKDF-Expand using HMAC-SHA-256.

    We only run the Expand stage: the KMS MAC is already a uniformly-random
    32-byte PRF output (it *is* an HMAC), so it is a valid pseudorandom key and
    a separate Extract step buys nothing. Deterministic by construction.
    """
    hash_len = hashlib.sha256().digest_size
    if length > 255 * hash_len:
        raise ValueError("HKDF: requested length too large")
    okm = b""
    block = b""
    counter = 1
    while len(okm) < length:
        block = hmac.new(ikm, block + info + bytes([counter]), hashlib.sha256).digest()
        okm += block
        counter += 1
    return okm[:length]


class KmsKeyProvider:
    """KeyProvider backed by an AWS KMS HMAC CMK (deterministic per UID).

    The boto3 KMS client is created lazily and never holds key material. A stub
    client implementing ``generate_mac``/``describe_key`` may be injected for
    tests (see ``test_kms_key_provider.py``) so no real AWS call is made.
    """

    def __init__(
        self,
        key_id: Optional[str] = None,
        key_region: Optional[str] = None,
        kms_client: Optional[Any] = None,
        principal: Optional[str] = None,
        validate_on_init: bool = False,
    ) -> None:
        self.key_id = key_id or os.environ.get(
            "AM_TAG_ROOT_KEY_ALIAS", DEFAULT_KEY_ALIAS
        )
        self.region = key_region or os.environ.get("AWS_REGION", DEFAULT_REGION)
        # Best-effort identity for the audit trail. Real attribution is in
        # CloudTrail (the call is signed by the execution role); this is a hint.
        self.principal = principal or os.environ.get("AM_TAG_ENCODER_PRINCIPAL", "unknown")
        self._client = kms_client  # injected stub or pre-built client; else lazy
        if validate_on_init:
            self.validate_key()

    # -- client management ---------------------------------------------------

    @property
    def client(self) -> Any:
        if self._client is None:
            import boto3  # lazy: tests with an injected stub never need boto3

            self._client = boto3.client("kms", region_name=self.region)
        return self._client

    def validate_key(self) -> None:
        """Confirm the CMK is an enabled HMAC_256 GENERATE_VERIFY_MAC key.

        Requires ``kms:DescribeKey``. Raises ``RuntimeError`` on mismatch so a
        misconfigured key fails closed at startup rather than mid-encode.
        """
        meta = self.client.describe_key(KeyId=self.key_id)["KeyMetadata"]
        spec = meta.get("KeySpec") or meta.get("CustomerMasterKeySpec")
        usage = meta.get("KeyUsage")
        enabled = meta.get("Enabled", False)
        if spec != "HMAC_256" or usage != "GENERATE_VERIFY_MAC" or not enabled:
            raise RuntimeError(
                "KMS key %r is not a usable HMAC_256 GENERATE_VERIFY_MAC key "
                "(spec=%r usage=%r enabled=%r)" % (self.key_id, spec, usage, enabled)
            )

    # -- contract ------------------------------------------------------------

    def derive_tag_key(self, tag_uid: bytes) -> bytes:
        """Derive the 16-byte AES-128 application key for ``tag_uid``.

        Deterministic for a given UID + KMS root. Audit-logged. The KMS root
        never leaves the HSM; only the per-tag MAC transits, and only the
        derived 16-byte key is returned.
        """
        if not isinstance(tag_uid, (bytes, bytearray)):
            raise TypeError("tag_uid must be bytes")
        if len(tag_uid) != NTAG424_UID_LEN:
            raise ValueError(
                "tag_uid must be exactly %d bytes (NTAG 424 DNA UID), got %d"
                % (NTAG424_UID_LEN, len(tag_uid))
            )

        uid = bytes(tag_uid)

        # KMS computes HMAC_SHA_256(root, uid) inside the HSM. The root is never
        # exposed; we receive only the 32-byte MAC over THIS uid.
        resp = self.client.generate_mac(
            KeyId=self.key_id,
            MacAlgorithm=KMS_MAC_ALGORITHM,
            Message=uid,
        )
        mac = resp["Mac"]
        if not isinstance(mac, (bytes, bytearray)) or len(mac) != 32:
            raise RuntimeError("KMS generate_mac returned unexpected MAC length")

        derived = _hkdf_expand(bytes(mac), _HKDF_INFO, AES128_KEY_LEN)

        # Audit: who / when (logging adds the timestamp) / which UID / which key
        # ref. NO key material, NO MAC. UID is non-secret tag hardware identity.
        audit_log.info(
            "tag_key_derived",
            extra={
                "event": "derive_tag_key",
                "principal": self.principal,
                "tag_uid": uid.hex(),
                "key_ref": self.key_id,
                "region": self.region,
                "kms_mac_algorithm": KMS_MAC_ALGORITHM,
            },
        )

        # Best-effort hygiene on the intermediate MAC buffer.
        try:
            mac_buf = bytearray(mac)
            for i in range(len(mac_buf)):
                mac_buf[i] = 0
        except Exception:  # pragma: no cover - defensive only
            pass

        return derived
