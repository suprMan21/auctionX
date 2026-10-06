"""AWS-KMS-backed chip-key provider for the NTAG 424 DNA encoder — S-NFC3.5.

SECURITY MODEL
--------------
* Two KMS **HMAC_256** keys per environment, separated by role (amended
  2026-10-01 by Boss: per-role KMS roots — KMS cannot restrict GenerateMac by
  message content, so role separation has to be root separation):

    SDM root    alias/am-tag-sdm-staging    roles META + FILE (backend + encoder)
    ADMIN root  alias/am-tag-admin-staging  role APP_MASTER    (encoder ONLY)

  Production gets its own ``-prod`` pair; staging and prod never share roots.
* Neither root ever leaves KMS. The provider sends the public KDF message to
  ``kms.generate_mac`` (HMAC_SHA_256) and runs one HKDF-Expand over the
  returned 32-byte MAC — exactly the derivation in
  ``tag_encoder.keyprovider`` / ``backend/src/services/nfc/keys`` (pinned by
  the shared OpenSSL vectors).
* Derived keys are returned to the caller and not retained: no caching.
* Audit log records role / version / key ref only — never key material, never
  the MAC, never the UID.
* This module NEVER creates, aliases or imports a key (guarded by a grep test).
  One-time key setup is a documented Boss action.

IAM: the encoder role needs ``kms:GenerateMac`` (+ ``kms:DescribeKey``) on
BOTH key ARNs; the backend role gets the SDM key ARN ONLY.
"""

from __future__ import annotations

import logging
import os
import sys
from typing import Any, Optional

# Allow `import kms_key_provider` from this directory as well as
# `import providers.kms_key_provider` from the tag-encoder root.
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from tag_encoder.keyprovider import (  # noqa: E402
    KEY_LEN,
    ROLE_ROOT,
    KeyProvider,
    hkdf_expand,
    kdf_info,
    kdf_message,
)

__all__ = ["KeyProvider", "KmsKeyProvider", "DEFAULT_SDM_KEY_ALIAS", "DEFAULT_ADMIN_KEY_ALIAS"]

audit_log = logging.getLogger("tag_encoder.providers.kms.audit")

DEFAULT_SDM_KEY_ALIAS = "alias/am-tag-sdm-staging"
DEFAULT_ADMIN_KEY_ALIAS = "alias/am-tag-admin-staging"
DEFAULT_REGION = "us-east-2"
KMS_MAC_ALGORITHM = "HMAC_SHA_256"
PRK_LEN = 32


class KmsKeyProvider:
    """KeyProvider backed by two AWS KMS HMAC keys (role -> root mapping).

    The boto3 client is created lazily; tests inject a stub implementing
    ``generate_mac`` / ``describe_key`` so no real AWS call is made.
    """

    def __init__(
        self,
        sdm_key_id: Optional[str] = None,
        admin_key_id: Optional[str] = None,
        key_region: Optional[str] = None,
        kms_client: Optional[Any] = None,
        principal: Optional[str] = None,
        validate_on_init: bool = False,
    ) -> None:
        self.key_ids = {
            "sdm": sdm_key_id or os.environ.get("AM_TAG_SDM_KEY_ID", DEFAULT_SDM_KEY_ALIAS),
            "admin": admin_key_id or os.environ.get("AM_TAG_ADMIN_KEY_ID", DEFAULT_ADMIN_KEY_ALIAS),
        }
        if self.key_ids["sdm"] == self.key_ids["admin"]:
            raise ValueError("SDM and ADMIN roots must be different KMS keys (role separation)")
        self.region = key_region or os.environ.get("AWS_REGION", DEFAULT_REGION)
        self.principal = principal or os.environ.get("AM_TAG_ENCODER_PRINCIPAL", "unknown")
        self._client = kms_client
        if validate_on_init:
            self.validate_keys()

    @property
    def client(self) -> Any:
        if self._client is None:
            import boto3  # lazy: tests with an injected stub never need boto3

            self._client = boto3.client("kms", region_name=self.region)
        return self._client

    def validate_keys(self) -> None:
        """Both roots must be enabled HMAC_256 / GENERATE_VERIFY_MAC keys (kms:DescribeKey)."""
        for name, key_id in self.key_ids.items():
            meta = self.client.describe_key(KeyId=key_id)["KeyMetadata"]
            spec = meta.get("KeySpec") or meta.get("CustomerMasterKeySpec")
            usage = meta.get("KeyUsage")
            enabled = meta.get("Enabled", False)
            if spec != "HMAC_256" or usage != "GENERATE_VERIFY_MAC" or not enabled:
                raise RuntimeError(
                    "KMS %s root %r is not a usable HMAC_256 GENERATE_VERIFY_MAC key "
                    "(spec=%r usage=%r enabled=%r)" % (name, key_id, spec, usage, enabled)
                )

    def derive_key(
        self, role: str, version: int, uid: Optional[bytes] = None, serial: Optional[bytes] = None
    ) -> bytes:
        msg = kdf_message(role, version, uid, serial)  # validates role / version / uid / serial
        key_id = self.key_ids[ROLE_ROOT[role]]
        resp = self.client.generate_mac(KeyId=key_id, MacAlgorithm=KMS_MAC_ALGORITHM, Message=msg)
        mac = resp.get("Mac")
        if not isinstance(mac, (bytes, bytearray)) or len(mac) != PRK_LEN:
            raise RuntimeError("KMS generate_mac returned an unexpected MAC length")
        prk = bytearray(mac)
        try:
            derived = hkdf_expand(bytes(prk), kdf_info(role, version), KEY_LEN)
        finally:
            for i in range(len(prk)):
                prk[i] = 0
        audit_log.info(
            "tag_key_derived",
            extra={
                "event": "derive_key",
                "principal": self.principal,
                "role": role,
                "key_version": version,
                "key_ref": key_id,
                "region": self.region,
                "kms_mac_algorithm": KMS_MAC_ALGORITHM,
            },
        )
        return derived
