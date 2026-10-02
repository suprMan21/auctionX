"""Chip-key derivation for the NTAG 424 DNA encoder — S-NFC3.5.

Locked spec (Decisions DB 2026-10-01), byte-identical to the backend
(`backend/src/services/nfc/keys/keyDerivation.ts`); both are pinned by the
shared OpenSSL vectors in `test-vectors/ntag424_sdm_vectors.json`:

    msg  = "AM-NTAG424-KDF" || 0x00 || role_ascii || 0x00 || version(1 byte) || uid_bytes
           (uid_bytes empty for META; exactly 7 bytes otherwise)
    prk  = HMAC-SHA256(root, msg)      -- KMS GenerateMac (providers/) or local HMAC
    key  = HKDF-Expand(prk, info = "NTAG424-DNA/" || role || "/AES128/v" || version, L = 16)

Roles and roots (amended 2026-10-01 by Boss: per-role KMS roots, because KMS
cannot restrict GenerateMac by message content):

    META        fleet-wide SDMMetaReadKey   -> SDM root   (backend + encoder)
    FILE        per-UID SDMFileReadKey      -> SDM root   (backend + encoder)
    APP_MASTER  per-UID application master  -> ADMIN root (encoder ONLY)

Derived keys exist only in memory for one encode: never cached, never
persisted, never printed.
"""

from __future__ import annotations

import hashlib
import hmac
from typing import Optional, Protocol, runtime_checkable

UID_LEN = 7
KEY_LEN = 16
ROOT_LEN = 32
KDF_LABEL = b"AM-NTAG424-KDF"

ROLE_META = "META"
ROLE_FILE = "FILE"
ROLE_APP_MASTER = "APP_MASTER"

#: Which root each role is derived from. The backend only ever holds "sdm".
ROLE_ROOT = {ROLE_META: "sdm", ROLE_FILE: "sdm", ROLE_APP_MASTER: "admin"}


def validate_request(role: str, version: int, uid: Optional[bytes]) -> bytes:
    """Validate (role, version, uid); returns the uid bytes to append (b"" for META)."""
    if role not in ROLE_ROOT:
        raise ValueError(f"unknown key role {role!r}")
    if not isinstance(version, int) or not (1 <= version <= 255):
        raise ValueError("key version must be an int in 1..255")
    if role == ROLE_META:
        if uid:
            raise ValueError("META keys are fleet-wide and take no UID")
        return b""
    if not isinstance(uid, (bytes, bytearray)) or len(uid) != UID_LEN:
        raise ValueError(f"{role} keys require a {UID_LEN}-byte UID")
    return bytes(uid)


def kdf_message(role: str, version: int, uid: Optional[bytes] = None) -> bytes:
    uid_bytes = validate_request(role, version, uid)
    return KDF_LABEL + b"\x00" + role.encode("ascii") + b"\x00" + bytes([version]) + uid_bytes


def kdf_info(role: str, version: int) -> bytes:
    return f"NTAG424-DNA/{role}/AES128/v{version}".encode("ascii")


def hkdf_expand(prk: bytes, info: bytes, length: int) -> bytes:
    """RFC 5869 HKDF-Expand with HMAC-SHA256 (stdlib only)."""
    if len(prk) < 32:
        raise ValueError("HKDF PRK must be at least 32 bytes")
    if length > 255 * 32:
        raise ValueError("HKDF length too large")
    okm = b""
    block = b""
    counter = 1
    while len(okm) < length:
        block = hmac.new(prk, block + info + bytes([counter]), hashlib.sha256).digest()
        okm += block
        counter += 1
    return okm[:length]


@runtime_checkable
class KeyProvider(Protocol):
    """Role-aware chip-key derivation. Local and KMS providers implement this."""

    def derive_key(self, role: str, version: int, uid: Optional[bytes] = None) -> bytes:
        """Returns a 16-byte AES-128 key. Deterministic for (root, role, version, uid)."""
        ...


class LocalKeyProvider:
    """Offline / staging provider: the HMAC step runs in-process.

    Takes TWO 32-byte roots (SDM root for META/FILE, ADMIN root for
    APP_MASTER) and refuses to construct without an explicit
    ``allow_local_keys=True`` — production encodes use the KMS provider.
    Produces exactly the same keys as KmsKeyProvider for the same root bytes.
    """

    def __init__(self, sdm_root: bytes, admin_root: bytes, *, allow_local_keys: bool = False) -> None:
        if not allow_local_keys:
            raise PermissionError("LocalKeyProvider refused: pass allow_local_keys=True (staging/dev only)")
        for name, root in (("sdm_root", sdm_root), ("admin_root", admin_root)):
            if not isinstance(root, (bytes, bytearray)) or len(root) != ROOT_LEN:
                raise ValueError(f"{name} must be {ROOT_LEN} bytes")
        if bytes(sdm_root) == bytes(admin_root):
            raise ValueError("sdm_root and admin_root must differ (role separation)")
        self._roots = {"sdm": bytes(sdm_root), "admin": bytes(admin_root)}

    def __repr__(self) -> str:  # never show root material
        return "LocalKeyProvider(<roots redacted>)"

    def derive_key(self, role: str, version: int, uid: Optional[bytes] = None) -> bytes:
        msg = kdf_message(role, version, uid)
        prk = hmac.new(self._roots[ROLE_ROOT[role]], msg, hashlib.sha256).digest()
        return hkdf_expand(prk, kdf_info(role, version), KEY_LEN)
