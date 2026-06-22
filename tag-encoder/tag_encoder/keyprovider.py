"""Key-provider abstraction for the NTAG 424 DNA encoder.

The encoder NEVER hardcodes a single master AES key reused across tags. Every
tag gets a DETERMINISTIC, per-UID 16-byte AES-128 key derived from a root
secret. This module pins the exact `KeyProvider` Protocol that a sibling agent
implements with an AWS-KMS backend (dropped in later under
`tag-encoder/providers/`), and ships a `LocalStubKeyProvider` for offline dev.

CONTRACT (do not change without updating the KMS provider):
    derive_tag_key(tag_uid: bytes) -> bytes
        tag_uid: exactly 7 bytes (the NTAG 424 DNA UID)
        returns: exactly 16 bytes (AES-128 key), DETERMINISTIC for a given
                 (provider config, tag_uid).
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from .aes import aes128_cmac

UID_LEN = 7
KEY_LEN = 16


@runtime_checkable
class KeyProvider(Protocol):
    """Per-tag AES-128 key derivation. The KMS backend implements this exactly."""

    def derive_tag_key(self, tag_uid: bytes) -> bytes:
        """tag_uid = 7 bytes; returns a deterministic 16-byte AES-128 key."""
        ...


# Dev-only root constant. NOT a tag key and NEVER written to a tag: it is the
# seed for a KDF, so each UID yields a distinct key. The production path uses
# AWS-KMS (a real CMK), not this constant. Override via LocalStubKeyProvider's
# constructor for reproducible test vectors.
_DEV_ROOT = bytes.fromhex("A11CE0DE5EC0DEBA5E5EEDC0DEC0FFEE")  # 16B dev seed


class LocalStubKeyProvider:
    """Deterministic dev key derivation via AES-128-CMAC of the UID under a root.

    Derivation (NIST SP 800-108 style single-block CMAC KDF):
        K_tag = AES-CMAC(root, "AM-NTAG424-KDF\\x01" || UID)

    AES-CMAC output is exactly 16 bytes = one AES-128 key. Deterministic, and
    distinct per UID — there is NO single master key reused across tags. This is
    a DEV stub only; real tags are personalized via the KMS provider.
    """

    _KDF_LABEL = b"AM-NTAG424-KDF\x01"

    def __init__(self, root_key: bytes = _DEV_ROOT) -> None:
        if len(root_key) != KEY_LEN:
            raise ValueError(f"root_key must be {KEY_LEN} bytes")
        self._root = bytes(root_key)

    def derive_tag_key(self, tag_uid: bytes) -> bytes:
        if len(tag_uid) != UID_LEN:
            raise ValueError(f"tag_uid must be {UID_LEN} bytes (got {len(tag_uid)})")
        msg = self._KDF_LABEL + bytes(tag_uid)
        key = aes128_cmac(self._root, msg)
        assert len(key) == KEY_LEN
        return key


def derive_tag_key_hex(provider: KeyProvider, uid_hex: str) -> str:
    """Convenience: derive a key from a hex UID, return uppercase hex."""
    uid = bytes.fromhex(uid_hex)
    return provider.derive_tag_key(uid).hex().upper()
