"""NXP AN12196 Secure Dynamic Messaging (SDM / SUN), AES mode — S-NFC3.5.

Chip-exact, and byte-identical to the backend verifier
(`backend/src/services/nfc/ntag424Codec.ts`). Both are pinned by the shared
OpenSSL-generated vectors in `test-vectors/ntag424_sdm_vectors.json`
(including AN12196's own all-zero-key example). The S-NFC2 "simplified CMAC"
(MAC over the ciphertext under a static per-tag key) is DELETED.

    PICCData  = PICCDataTag(1) || UID(7) || SDMReadCtr(3, little-endian) || padding(5)
    ENCPICCData = AES-128-CBC-encrypt(SDMMetaReadKey, IV = 0, PICCData)
    PICCDataTag: bit7 UID mirrored, bit6 SDMReadCtr mirrored, bits3..0 UID length
    SV2       = 3C C3 00 01 00 80 || UID(7) || SDMReadCtr(3, LE as on the wire)
    KSesSDMFileReadMAC = AES-CMAC(SDMFileReadKey, SV2)
    SDMMAC    = AES-CMAC(KSesSDMFileReadMAC, file[SDMMACInputOffset : SDMMACOffset])
    on wire   = even-numbered bytes of SDMMAC (indices 1,3,...,15) -> 8 bytes

Our NDEF layouts (no SDMENCFileData in either):

    v1  `{base}/verify/{token}?picc_data=<32 hex>&cmac=<16 hex>`
        SDMMACInputOffset == SDMMACOffset -> the MAC input is the empty string.
    v2  `{base}/verify/{token}?sn=<16 hex>&picc_data=<32 hex>&cmac=<16 hex>`
        (S-NFC-ID) SDMMACInputOffset = start of the serial value, so every
        tap's MAC covers `<SERIAL>&picc_data=<ENCPICCData>&cmac=`.

`extract_mac_input` implements the general range.
"""

from __future__ import annotations

import hmac
import os
from dataclasses import dataclass

from ..aes import aes128_cbc_decrypt_nopad, aes128_cbc_encrypt_nopad, aes128_cmac
from ..ndef import build_ndef_uri_file

PICC_DATA_TAG = 0xC7  # UID mirrored | ctr mirrored | UID length 7
PICC_BLOCK_LEN = 16
UID_LEN = 7
COUNTER_MAX = 0xFFFFFF
SDM_MAC_LEN = 8
SV2_PREFIX = bytes.fromhex("3CC300010080")
ZERO_IV = bytes(16)

# Placeholders written into the NDEF file at personalisation; the chip
# overwrites them on every read (ASCII hex mirroring).
PICC_PLACEHOLDER = "0" * 32
MAC_PLACEHOLDER = "0" * 16

SERIAL_LEN = 8  # bytes; 16 uppercase hex in the URL (S-NFC-ID)
SERIAL_PARAM = "sn"


def serial_hex(serial: bytes | str) -> str:
    """Canonical URL form of a chip serial: 16 uppercase hex chars."""
    return _as_bytes(serial, SERIAL_LEN, "serial").hex().upper()


def v2_mac_input(serial: bytes | str, enc_picc_hex: str) -> bytes:
    """The bytes a v2 chip MACs: `<SERIAL>&picc_data=<ENCPICCData>&cmac=` (ASCII)."""
    return f"{serial_hex(serial)}&picc_data={enc_picc_hex.upper()}&cmac=".encode("ascii")


def _as_bytes(value: bytes | str, length: int, name: str) -> bytes:
    if isinstance(value, str):
        value = bytes.fromhex(value)
    if len(value) != length:
        raise ValueError(f"{name} must be {length} bytes (got {len(value)})")
    return bytes(value)


# --- PICCData ----------------------------------------------------------------


@dataclass(frozen=True)
class PiccDataTag:
    uid_mirrored: bool
    ctr_mirrored: bool
    uid_length: int

    @property
    def acceptable(self) -> bool:
        """Our layout needs UID (7 bytes) AND the counter mirrored."""
        return self.uid_mirrored and self.ctr_mirrored and self.uid_length == UID_LEN


def parse_picc_data_tag(byte: int) -> PiccDataTag:
    return PiccDataTag(bool(byte & 0x80), bool(byte & 0x40), byte & 0x0F)


@dataclass(frozen=True)
class PiccData:
    uid: bytes
    counter_le: bytes  # exactly as on the wire — the SV2 input
    counter: int

    @property
    def uid_hex(self) -> str:
        return self.uid.hex().upper()


def build_picc_plaintext(uid: bytes | str, counter: int, padding: bytes | str | None = None) -> bytes:
    """PICCDataTag 0xC7 || UID || SDMReadCtr (3 LE) || 5 padding bytes (random, as on silicon)."""
    uid = _as_bytes(uid, UID_LEN, "uid")
    if not (0 <= counter <= COUNTER_MAX):
        raise ValueError("counter must fit in 3 bytes (0..16777215)")
    pad = os.urandom(5) if padding is None else _as_bytes(padding, 5, "padding")
    return bytes([PICC_DATA_TAG]) + uid + counter.to_bytes(3, "little") + pad


def parse_picc_plaintext(plain: bytes) -> PiccData | None:
    if len(plain) != PICC_BLOCK_LEN or not parse_picc_data_tag(plain[0]).acceptable:
        return None
    ctr = plain[1 + UID_LEN : 1 + UID_LEN + 3]
    return PiccData(uid=plain[1 : 1 + UID_LEN], counter_le=ctr, counter=int.from_bytes(ctr, "little"))


def encrypt_picc_block(plaintext: bytes, meta_key: bytes | str) -> bytes:
    if len(plaintext) != PICC_BLOCK_LEN:
        raise ValueError("PICCData must be 16 bytes")
    return aes128_cbc_encrypt_nopad(_as_bytes(meta_key, 16, "meta_key"), ZERO_IV, plaintext)


def decrypt_picc_block(enc: bytes | str, meta_key: bytes | str) -> bytes:
    return aes128_cbc_decrypt_nopad(_as_bytes(meta_key, 16, "meta_key"), ZERO_IV, _as_bytes(enc, 16, "ENCPICCData"))


def decrypt_picc_data(enc: bytes | str, meta_key: bytes | str) -> PiccData | None:
    """Decrypt + parse; None unless it decodes to an acceptable PICCData."""
    try:
        return parse_picc_plaintext(decrypt_picc_block(enc, meta_key))
    except ValueError:
        return None


# --- SDM MAC -----------------------------------------------------------------


def build_sv2(uid: bytes, counter_le: bytes) -> bytes:
    return SV2_PREFIX + _as_bytes(uid, UID_LEN, "uid") + _as_bytes(counter_le, 3, "counter_le")


def session_mac_key(file_key: bytes | str, uid: bytes, counter_le: bytes) -> bytes:
    """KSesSDMFileReadMAC = AES-CMAC(SDMFileReadKey, SV2)."""
    return aes128_cmac(_as_bytes(file_key, 16, "file_key"), build_sv2(uid, counter_le))


def truncate_sdm_mac(full: bytes) -> bytes:
    """AN12196: the even-numbered bytes (1-based) = indices 1,3,...,15."""
    if len(full) != 16:
        raise ValueError("full CMAC must be 16 bytes")
    return bytes(full[i] for i in range(1, 16, 2))


def extract_mac_input(file_data: bytes, mac_input_offset: int, sdm_mac_offset: int) -> bytes:
    """MAC input = mirrored file bytes from SDMMACInputOffset up to SDMMACOffset."""
    if mac_input_offset < 0 or sdm_mac_offset < mac_input_offset or sdm_mac_offset > len(file_data):
        raise ValueError("SDM MAC input range out of bounds")
    return bytes(file_data[mac_input_offset:sdm_mac_offset])


def full_sdm_mac(file_key: bytes | str, uid: bytes, counter_le: bytes, mac_input: bytes = b"") -> bytes:
    return aes128_cmac(session_mac_key(file_key, uid, counter_le), mac_input)


def sdm_mac(file_key: bytes | str, uid: bytes, counter_le: bytes, mac_input: bytes = b"") -> bytes:
    return truncate_sdm_mac(full_sdm_mac(file_key, uid, counter_le, mac_input))


def verify_sdm_mac(
    file_key: bytes | str, uid: bytes, counter_le: bytes, mac_input: bytes, presented: bytes
) -> bool:
    """Constant-time compare of the presented 8-byte MAC."""
    return hmac.compare_digest(sdm_mac(file_key, uid, counter_le, mac_input), bytes(presented))


# --- URL / NDEF ----------------------------------------------------------------

_URIC_SAFE = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
)


def encode_uri_component(value: str) -> str:
    """Port of JavaScript `encodeURIComponent` (UTF-8, uppercase %XX)."""
    return "".join(
        chr(b) if chr(b) in _URIC_SAFE else f"%{b:02X}" for b in value.encode("utf-8")
    )


def build_sun_url(
    base_url: str, token_name: str, enc_picc_hex: str, cmac_hex: str, serial: bytes | str | None = None
) -> str:
    """`{base}/verify/{encodeURIComponent(token)}?[sn=<hex>&]picc_data=<hex>&cmac=<hex>` (backend parity)."""
    trimmed = base_url[:-1] if base_url.endswith("/") else base_url
    sn = f"{SERIAL_PARAM}={serial_hex(serial)}&" if serial is not None else ""
    return f"{trimmed}/verify/{encode_uri_component(token_name)}?{sn}picc_data={enc_picc_hex}&cmac={cmac_hex}"


@dataclass(frozen=True)
class SdmTemplate:
    """The NDEF file written at personalisation + the SDM offsets into it."""

    ndef_bytes: bytes
    picc_data_offset: int
    sdm_mac_input_offset: int
    sdm_mac_offset: int


def build_sdm_template(base_url: str, token_name: str, serial: bytes | str | None = None) -> SdmTemplate:
    """NDEF file with placeholder mirrors, and the file offsets the chip writes to.

    Offsets count from the start of the NDEF FILE (including the 2-byte NLEN),
    as ChangeFileSettings expects. Without a serial (v1) SDMMACInputOffset ==
    SDMMACOffset, so the MAC input range is empty. With a serial (v2) the range
    starts at the serial value, so the serial is MAC-covered on every tap.
    """
    url = build_sun_url(base_url, token_name, PICC_PLACEHOLDER, MAC_PLACEHOLDER, serial)
    ndef = build_ndef_uri_file(url)
    lead = "&" if serial is not None else "?"
    picc_marker = (lead + "picc_data=" + PICC_PLACEHOLDER).encode("ascii")
    mac_marker = ("&cmac=" + MAC_PLACEHOLDER).encode("ascii")
    p = ndef.rfind(picc_marker)
    m = ndef.rfind(mac_marker)
    if p < 0 or m < 0:
        raise ValueError("SDM placeholders not found in the NDEF template")
    picc_off = p + len(lead + "picc_data=")
    mac_off = m + len("&cmac=")
    if serial is None:
        return SdmTemplate(ndef, picc_off, mac_off, mac_off)
    sn_marker = f"?{SERIAL_PARAM}={serial_hex(serial)}&picc_data=".encode("ascii")
    s = ndef.rfind(sn_marker)
    if s < 0:
        raise ValueError("serial not found in the NDEF template")
    if s + len(sn_marker) != picc_off:
        raise ValueError("serial does not immediately precede picc_data")
    return SdmTemplate(ndef, picc_off, s + len(f"?{SERIAL_PARAM}="), mac_off)


def serial_from_ndef(image: bytes) -> bytes | None:
    """The v2 serial in an NDEF file image read off a chip, or None if there is none."""
    marker = f"?{SERIAL_PARAM}=".encode("ascii")
    i = image.rfind(marker)
    if i < 0:
        return None
    raw = image[i + len(marker) : i + len(marker) + 2 * SERIAL_LEN]
    try:
        text = raw.decode("ascii")
        if len(text) != 2 * SERIAL_LEN or text != text.upper():
            return None
        return bytes.fromhex(text)
    except ValueError:
        return None


def mirror_into_template(template: SdmTemplate, enc_picc: bytes, mac: bytes) -> bytes:
    """What the chip returns on read: the template with ASCII-hex mirrors written in."""
    buf = bytearray(template.ndef_bytes)
    picc_ascii = enc_picc.hex().upper().encode("ascii")
    mac_ascii = mac.hex().upper().encode("ascii")
    buf[template.picc_data_offset : template.picc_data_offset + 32] = picc_ascii
    buf[template.sdm_mac_offset : template.sdm_mac_offset + 16] = mac_ascii
    return bytes(buf)


def mac_input_for(template: SdmTemplate, enc_picc: bytes) -> bytes:
    """What the chip MACs on a read: the mirrored file bytes in the MAC input range."""
    image = mirror_into_template(template, enc_picc, bytes(SDM_MAC_LEN))
    return extract_mac_input(image, template.sdm_mac_input_offset, template.sdm_mac_offset)


# --- Encode / verify pipelines --------------------------------------------------


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
    meta_key: bytes | str,
    file_key: bytes | str,
    base_url: str,
    token_name: str,
    padding: bytes | str | None = None,
    serial: bytes | str | None = None,
) -> EncodeResult:
    """Simulate one tap of a personalised chip: exactly what silicon mirrors."""
    uid_b = _as_bytes(uid, UID_LEN, "uid")
    plain = build_picc_plaintext(uid_b, counter, padding)
    enc = encrypt_picc_block(plain, meta_key)
    template = build_sdm_template(base_url, token_name, serial)
    mac = sdm_mac(file_key, uid_b, plain[8:11], mac_input_for(template, enc))
    ndef = mirror_into_template(template, enc, mac)
    return EncodeResult(
        enc_picc_hex=enc.hex().upper(),
        cmac_hex=mac.hex().upper(),
        sun_url=build_sun_url(base_url, token_name, enc.hex().upper(), mac.hex().upper(), serial),
        ndef_bytes=ndef,
    )


@dataclass(frozen=True)
class VerifyResult:
    valid: bool
    uid_hex: str | None
    counter: int | None
    error: str | None  # malformed | invalid_signature | uid_mismatch | replay_detected


def verify_sun(
    enc_picc_hex: str,
    cmac_hex: str,
    meta_key: bytes,
    file_key_for_uid,
    last_counter: int,
    expected_uid: str | None = None,
    serial: bytes | str | None = None,
) -> VerifyResult:
    """Mirror of the backend `validateSunScan` (same order, same error codes).

    `file_key_for_uid(uid: bytes) -> bytes` derives the per-chip FILE key only
    after PICCData has been authenticated-decrypted. With a `serial` (v2) the
    MAC input is `v2_mac_input(serial, enc_picc_hex)`.
    """
    try:
        enc = bytes.fromhex(enc_picc_hex)
        mac = bytes.fromhex(cmac_hex)
    except ValueError:
        return VerifyResult(False, None, None, "malformed")
    if len(enc) != 16 or len(mac) != SDM_MAC_LEN:
        return VerifyResult(False, None, None, "malformed")
    picc = decrypt_picc_data(enc, meta_key)
    if picc is None:
        return VerifyResult(False, None, None, "invalid_signature")
    if expected_uid is not None and expected_uid.upper() != picc.uid_hex:
        return VerifyResult(False, picc.uid_hex, picc.counter, "uid_mismatch")
    mac_input = v2_mac_input(serial, enc_picc_hex) if serial is not None else b""
    if not verify_sdm_mac(file_key_for_uid(picc.uid), picc.uid, picc.counter_le, mac_input, mac):
        return VerifyResult(False, picc.uid_hex, picc.counter, "invalid_signature")
    if picc.counter <= last_counter:
        return VerifyResult(False, picc.uid_hex, picc.counter, "replay_detected")
    return VerifyResult(True, picc.uid_hex, picc.counter, None)
