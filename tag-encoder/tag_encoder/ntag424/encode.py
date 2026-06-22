"""Pure encode pipeline — the SIMULATOR-PARITY core of S-NFC2 (Lane A).

`encode_sun(uid, counter, key, base_url, token_name)` produces the exact same
(encPiccHex, cmacHex, sunUrl) that the backend simulator emits in
`backend/src/services/nfc/ntag424Simulator.ts` (`simulateTap`), and an
`ndefBytes` image that round-trips through `tag_hq.parsers.parse_ndef`.

The decrypt of the produced `encPiccHex` with the same key recovers the
original (uid, counter) — mirroring the backend `decryptPiccData` in
`backend/src/services/nfc/ntag424.ts`.

==========================================================================
SIM-PARITY CONTRACT (Phase 1, SIM-ONLY) — DO NOT SILENTLY DIVERGE
==========================================================================
The simulator + backend use a SIMPLIFIED scheme:

  * PICC plaintext (16B): 0xC7 || UID(7B) || counter(3B LE) || 0x00*5
  * Encrypt: AES-128-CBC, zero IV (16 null bytes), per-tag 16B key.
  * CMAC: AES-128-CMAC (RFC 4493) over the *encrypted PICC bytes*,
    truncated to the first 8 bytes (16 hex chars).

This is NOT the full NXP AN12196 SDM scheme that genuine NTAG 424 DNA
silicon emits. Real silicon:
  * derives a per-tap SDM session key (SesSDMFileReadMACKey / ENCKey) from
    the file-read key + the SDMReadCtr (KSDFAuth / CMAC-based KDF), and
  * computes the SDMMAC over the *cleartext mirror inputs*, not over the
    encrypted PICCData block as we do here.

Phase 1 deliberately targets SIMULATOR PARITY so the encoder, simulator,
and backend agree end-to-end with no hardware in the loop. Phase 2 (real
silicon) MUST realign BOTH this encoder AND the backend verifier to true
AN12196 SDM session-CMAC. See SIM_PARITY.md.
==========================================================================
"""

from __future__ import annotations

from dataclasses import dataclass

from ..aes import aes128_cbc_encrypt_nopad, aes128_cmac
from ..ndef import build_ndef_uri_file

PICC_HEADER = 0xC7
PICC_BLOCK_LEN = 16
UID_LEN = 7
COUNTER_MAX = 0xFFFFFF
CMAC_TRUNCATE_BYTES = 8  # NTAG 424 DNA SDMMAC truncation


def _coerce_uid(uid: bytes | str) -> bytes:
    if isinstance(uid, str):
        uid = bytes.fromhex(uid)
    if len(uid) != UID_LEN:
        raise ValueError(f"uid must be {UID_LEN} bytes (got {len(uid)})")
    return uid


def _coerce_key(key: bytes | str) -> bytes:
    if isinstance(key, str):
        key = bytes.fromhex(key)
    if len(key) != 16:
        raise ValueError(f"key must be 16 bytes (got {len(key)})")
    return key


def build_picc_block(uid: bytes | str, counter: int) -> bytes:
    """0xC7 || UID(7B) || counter(3B little-endian) || 0x00*5  (16 bytes)."""
    uid = _coerce_uid(uid)
    if not (0 <= counter <= COUNTER_MAX):
        raise ValueError("counter must fit in 3 bytes (0..16777215)")
    block = bytearray(PICC_BLOCK_LEN)
    block[0] = PICC_HEADER
    block[1:8] = uid
    block[8] = counter & 0xFF
    block[9] = (counter >> 8) & 0xFF
    block[10] = (counter >> 16) & 0xFF
    return bytes(block)


def encrypt_picc_data(uid: bytes | str, counter: int, key: bytes | str) -> str:
    """AES-128-CBC (zero IV, no padding) over the PICC block -> uppercase hex.

    Parity target: `encryptPiccData()` in ntag424Simulator.ts.
    """
    key = _coerce_key(key)
    block = build_picc_block(uid, counter)
    enc = aes128_cbc_encrypt_nopad(key, bytes(16), block)
    return enc.hex().upper()


def compute_cmac_hex(enc_picc_hex: str, key: bytes | str) -> str:
    """Full 16-byte AES-128-CMAC over the encrypted PICC bytes -> uppercase hex.

    Parity target: `computeCmac()` in ntag424.ts (full, untruncated).
    """
    key = _coerce_key(key)
    mac = aes128_cmac(key, bytes.fromhex(enc_picc_hex))
    return mac.hex().upper()


def truncated_cmac_hex(enc_picc_hex: str, key: bytes | str) -> str:
    """First 8 bytes (16 hex chars) of the CMAC — what the SUN URL carries."""
    return compute_cmac_hex(enc_picc_hex, key)[: CMAC_TRUNCATE_BYTES * 2].upper()


# --- encodeURIComponent parity --------------------------------------------
# The simulator builds the path segment with JS `encodeURIComponent(tokenName)`.
# RFC 3986 unreserved + the JS-exempt set: A-Z a-z 0-9 - _ . ! ~ * ' ( )
_URIC_SAFE = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
)


def encode_uri_component(value: str) -> str:
    """Port of JavaScript `encodeURIComponent` (UTF-8, uppercase %XX)."""
    out: list[str] = []
    for byte in value.encode("utf-8"):
        ch = chr(byte)
        if ch in _URIC_SAFE:
            out.append(ch)
        else:
            out.append(f"%{byte:02X}")
    return "".join(out)


def build_sun_url(base_url: str, token_name: str, enc_picc_hex: str, cmac_hex: str) -> str:
    """`{base}/verify/{encodeURIComponent(token)}?picc_data=<hex>&cmac=<hex>`.

    Parity target: `buildSunUrl()` in ntag424Simulator.ts (trailing slash on
    base is stripped; token segment uses encodeURIComponent; picc_data/cmac are
    pure hex so x-www-form-urlencoded vs percent-encoding is a no-op for them).
    """
    trimmed = base_url[:-1] if base_url.endswith("/") else base_url
    token = encode_uri_component(token_name)
    return f"{trimmed}/verify/{token}?picc_data={enc_picc_hex}&cmac={cmac_hex}"


@dataclass(frozen=True)
class EncodeResult:
    enc_picc_hex: str
    cmac_hex: str
    sun_url: str
    ndef_bytes: bytes

    def as_dict(self) -> dict[str, str]:
        return {
            "encPiccHex": self.enc_picc_hex,
            "cmacHex": self.cmac_hex,
            "sunUrl": self.sun_url,
            "ndefBytes": self.ndef_bytes.hex().upper(),
        }


def encode_sun(
    uid: bytes | str,
    counter: int,
    key: bytes | str,
    base_url: str,
    token_name: str,
) -> EncodeResult:
    """Full pure encode pipeline. SIM-parity with simulateTap() + NDEF image."""
    enc_picc_hex = encrypt_picc_data(uid, counter, key)
    cmac_hex = truncated_cmac_hex(enc_picc_hex, key)
    sun_url = build_sun_url(base_url, token_name, enc_picc_hex, cmac_hex)
    ndef_bytes = build_ndef_uri_file(sun_url)
    return EncodeResult(
        enc_picc_hex=enc_picc_hex,
        cmac_hex=cmac_hex,
        sun_url=sun_url,
        ndef_bytes=ndef_bytes,
    )


# --- decrypt (mirror of backend decryptPiccData) ---------------------------

def decrypt_picc_data(enc_picc_hex: str, key: bytes | str) -> tuple[str, int] | None:
    """Recover (uid_hex_upper, counter) from encrypted PICC data, or None.

    Mirror of `decryptPiccData()` in ntag424.ts. Used by the `verify` CLI and
    by the parity round-trip test. Implemented via CBC-decrypt of a single
    block: since IV is zero and there is exactly one block, plaintext =
    AES-decrypt(ciphertext). We avoid pulling in an AES decrypt path by noting
    the block is recoverable through re-encryption search is NOT needed — we
    decrypt properly below.
    """
    from ..aes import _expand_key, _SBOX  # noqa: F401  (kept local; see _aes_decrypt_block)

    data = bytes.fromhex(enc_picc_hex)
    if len(data) != 16:
        return None
    plain = _aes128_decrypt_block(_coerce_key(key), data)  # zero IV, single block
    if plain[0] != PICC_HEADER:
        return None
    uid = plain[1:8].hex().upper()
    counter = plain[8] | (plain[9] << 8) | (plain[10] << 16)
    return uid, counter


# Inverse AES-128 block (decrypt) — only needed for the verify/round-trip path.
_INV_SBOX = bytes(255 for _ in range(0))  # placeholder, filled below


def _build_inv_sbox() -> bytes:
    from ..aes import _SBOX

    inv = bytearray(256)
    for i, s in enumerate(_SBOX):
        inv[s] = i
    return bytes(inv)


_INV_SBOX = _build_inv_sbox()


def _aes128_decrypt_block(key: bytes, block: bytes) -> bytes:
    from ..aes import _expand_key, _mul

    rks = _expand_key(key)
    state = list(block)

    def add_round_key(rk: list[int]) -> None:
        for i in range(16):
            state[i] ^= rk[i]

    def inv_sub_bytes() -> None:
        for i in range(16):
            state[i] = _INV_SBOX[state[i]]

    def inv_shift_rows() -> None:
        new = state[:]
        for row in range(1, 4):
            for col in range(4):
                new[row + 4 * col] = state[row + 4 * ((col - row) % 4)]
        state[:] = new

    def inv_mix_columns() -> None:
        for c in range(4):
            i = 4 * c
            a0, a1, a2, a3 = state[i], state[i + 1], state[i + 2], state[i + 3]
            state[i] = _mul(a0, 14) ^ _mul(a1, 11) ^ _mul(a2, 13) ^ _mul(a3, 9)
            state[i + 1] = _mul(a0, 9) ^ _mul(a1, 14) ^ _mul(a2, 11) ^ _mul(a3, 13)
            state[i + 2] = _mul(a0, 13) ^ _mul(a1, 9) ^ _mul(a2, 14) ^ _mul(a3, 11)
            state[i + 3] = _mul(a0, 11) ^ _mul(a1, 13) ^ _mul(a2, 9) ^ _mul(a3, 14)

    add_round_key(rks[10])
    for rnd in range(9, 0, -1):
        inv_shift_rows()
        inv_sub_bytes()
        add_round_key(rks[rnd])
        inv_mix_columns()
    inv_shift_rows()
    inv_sub_bytes()
    add_round_key(rks[0])
    return bytes(state)
