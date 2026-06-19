"""Pure parsers for NTAG 424 DNA diagnostic data. No I/O — bytes in, dataclasses out.

Kept side-effect-free so S-NFC2 can reuse them and so they unit-test without
hardware. Sources: AN12196 Rev 2.0, NT4H2421Gx datasheet Rev 3.0 §8/§10.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# AM-SEALED acceptance reference for genuine plain NTAG 424 DNA.
# CORRECTED 2026-06-19 (DR-9 analysis 3843…94be; Decisions DB 3843…0a59, which
# amends the prior "Gx = HW sub-type 0x08" error in 3843…fe47). Do NOT assert on
# the brittle HW sub-type nibble: genuine plain NTAG 424 DNA returns 0x02, while
# the 0x08 the project trusted is AN12196's "50 pF, strong back modulation" example
# byte, not a clean part identifier. Assert instead on the STABLE TUPLE below plus a
# passing ECC originality-signature verify (the real genuineness gate, in §3).
NXP_VENDOR_ID = 0x04
REF_HW_TYPE = 0x04       # GetVersion HW byte 2 (p1[1]) — NTAG product family
REF_STORAGE = 0x11       # HW byte 6 (p1[5]) — 256<size<512 → NTAG 424 DNA class (416B)
REF_PROTOCOL = 0x05      # HW byte 7 (p1[6]) — ISO/IEC 14443-4
REF_SW_SUBTYPE = 0x02    # SW byte 10 (p2[2]) — constant across the 424 DNA family


# --- GetVersion ------------------------------------------------------------
@dataclass(frozen=True)
class VersionInfo:
    raw: bytes
    vendor_id: int
    hw_type: int
    hw_subtype: int
    hw_major: int
    hw_minor: int
    storage_size: int
    protocol: int
    sw_type: int
    sw_subtype: int
    uid: bytes  # 7 bytes; INVALID if random_id is True
    prefix14: bytes
    matches_reference: bool  # matches the AM-SEALED NTAG 424 DNA acceptance tuple
    possible_tt: bool        # HW sub-type high nibble set → maybe TagTamper (needs GetTTStatus)
    is_nxp: bool
    variant: str  # "NTAG 424 DNA (plain)" | "NTAG 424 DNA (TagTamper?)" | "NXP, off-reference" | "non-NXP"
    notes: list[str] = field(default_factory=list)

    @property
    def uid_hex(self) -> str:
        return self.uid.hex().upper()


def parse_get_version(p1: bytes, p2: bytes, p3: bytes) -> VersionInfo:
    """Parse the 3-part GetVersion response. Each part is the data field only.

    p1 = HW info (7 bytes), p2 = SW info (7 bytes), p3 = production info
    (UID at bytes 0..6).
    """
    raw = p1 + p2 + p3
    notes: list[str] = []

    vendor = p1[0] if len(p1) > 0 else -1
    hw_type = p1[1] if len(p1) > 1 else -1
    hw_subtype = p1[2] if len(p1) > 2 else -1
    hw_major = p1[3] if len(p1) > 3 else -1
    hw_minor = p1[4] if len(p1) > 4 else -1
    storage = p1[5] if len(p1) > 5 else -1
    protocol = p1[6] if len(p1) > 6 else -1
    sw_type = p2[1] if len(p2) > 1 else -1
    sw_subtype = p2[2] if len(p2) > 2 else -1

    uid = p3[0:7] if len(p3) >= 7 else p3
    prefix14 = (p1[:7] + p2[:7]) if (len(p1) >= 7 and len(p2) >= 7) else b""

    is_nxp = vendor == NXP_VENDOR_ID
    # Assert on the stable tuple, NOT the brittle HW sub-type nibble (DR-9).
    matches_reference = (
        is_nxp
        and hw_type == REF_HW_TYPE
        and storage == REF_STORAGE
        and protocol == REF_PROTOCOL
        and sw_subtype == REF_SW_SUBTYPE
    )
    # On the Tx (TagTamper) part the HW sub-type HIGH nibble carries the tamper
    # flag; a non-zero high nibble means we cannot exclude TagTamper from bytes
    # alone — only an authenticated GetTTStatus (out of this read-only station's
    # scope) is definitive. Plain stock returns a zero high nibble (e.g. 0x02).
    possible_tt = is_nxp and (hw_subtype >> 4) != 0

    if not is_nxp:
        notes.append(f"vendor 0x{vendor:02X} is not NXP (0x04)")

    if matches_reference and not possible_tt:
        variant = "NTAG 424 DNA (plain)"
    elif matches_reference and possible_tt:
        variant = "NTAG 424 DNA (TagTamper?)"
        notes.append(
            "HW sub-type high nibble set — cannot exclude TagTamper (Tx) from bytes; "
            "GetTTStatus needed (rejected hardware if confirmed Tx)"
        )
    elif is_nxp:
        variant = "NXP, off-reference"
        notes.append(
            "GetVersion does not match the AM-SEALED NTAG 424 DNA reference tuple "
            f"(type 0x{hw_type:02X} storage 0x{storage:02X} sw-subtype 0x{sw_subtype:02X} proto 0x{protocol:02X})"
        )
    else:
        variant = "non-NXP / off-spec"

    return VersionInfo(
        raw=raw, vendor_id=vendor, hw_type=hw_type, hw_subtype=hw_subtype,
        hw_major=hw_major, hw_minor=hw_minor, storage_size=storage, protocol=protocol,
        sw_type=sw_type, sw_subtype=sw_subtype, uid=uid, prefix14=prefix14,
        matches_reference=matches_reference, possible_tt=possible_tt, is_nxp=is_nxp,
        variant=variant, notes=notes,
    )


# --- Activation / RF -------------------------------------------------------
@dataclass(frozen=True)
class Activation:
    atr_hex: str
    historical_hex: str
    uid_from_reader: str       # may be 4-byte random or 7-byte real
    random_id: bool            # True if reader UID looks like a 4-byte RID (0x08 prefix)
    notes: list[str] = field(default_factory=list)


def parse_activation(atr: bytes, reader_uid: bytes) -> Activation:
    """Best-effort RF activation summary from the PC/SC pseudo-ATR + reader UID.

    Random-ID heuristic: ISO14443-3 single-size random IDs are 4 bytes with a
    0x08 leading nibble/byte. A genuine NTAG 424 UID is 7 bytes starting 0x04.
    """
    notes: list[str] = []
    # PC/SC pseudo-ATR historical bytes live between T0 and the checksum; we
    # surface the raw ATR and let the dashboard show it verbatim.
    historical = atr[4:-1] if len(atr) > 5 else b""
    random_id = len(reader_uid) == 4 and reader_uid[0] == 0x08
    if random_id:
        notes.append("4-byte random ID (0x08…) — true UID hidden; originality verify will need GetCardUID")
    elif len(reader_uid) == 7 and reader_uid[0] != NXP_VENDOR_ID:
        notes.append(f"7-byte UID does not start with NXP 0x04 (got 0x{reader_uid[0]:02X})")
    return Activation(
        atr_hex=atr.hex().upper(),
        historical_hex=historical.hex().upper(),
        uid_from_reader=reader_uid.hex().upper(),
        random_id=random_id,
        notes=notes,
    )


# --- Capability Container --------------------------------------------------
@dataclass(frozen=True)
class CapabilityContainer:
    raw: bytes
    cclen: int
    mapping_version: str
    ndef_file_id: int
    ndef_max_size: int
    read_access: int
    write_access: int

    @property
    def read_only(self) -> bool:
        return self.write_access == 0xFF


def parse_cc(data: bytes) -> CapabilityContainer | None:
    """Parse the Type-4 Capability Container (15 bytes on NTAG 424 DNA)."""
    if len(data) < 15:
        return None
    cclen = int.from_bytes(data[0:2], "big")
    mapping = f"{data[2] >> 4}.{data[2] & 0x0F}"
    # NDEF File Control TLV starts at offset 7: T=04, L=06, then 6 bytes value.
    ndef_id = int.from_bytes(data[9:11], "big")
    ndef_max = int.from_bytes(data[11:13], "big")
    read_access = data[13]
    write_access = data[14]
    return CapabilityContainer(
        raw=data[:15], cclen=cclen, mapping_version=mapping, ndef_file_id=ndef_id,
        ndef_max_size=ndef_max, read_access=read_access, write_access=write_access,
    )


# --- NDEF ------------------------------------------------------------------
@dataclass(frozen=True)
class NdefSummary:
    nlen: int
    uri: str | None
    is_sdm_mirror: bool       # heuristic: URL contains SDM placeholders/params
    raw_hex: str
    notes: list[str] = field(default_factory=list)


_URI_PREFIXES = {
    0x00: "", 0x01: "http://www.", 0x02: "https://www.", 0x03: "http://",
    0x04: "https://", 0x05: "tel:", 0x06: "mailto:",
}


def parse_ndef(data: bytes) -> NdefSummary | None:
    """Parse an NDEF file: 2-byte NLEN + NDEF message. Extracts a URI record if present."""
    if len(data) < 2:
        return None
    nlen = int.from_bytes(data[0:2], "big")
    msg = data[2 : 2 + nlen] if nlen else b""
    uri: str | None = None
    notes: list[str] = []
    # Minimal NDEF parse for a single well-known URI ('U') record.
    if len(msg) >= 4 and (msg[0] & 0x07) == 0x01 and msg[1] == 0x01:
        try:
            type_len = msg[1]
            payload_len = msg[2]
            rtype = msg[3 : 3 + type_len]
            payload = msg[3 + type_len : 3 + type_len + payload_len]
            if rtype == b"U" and payload:
                prefix = _URI_PREFIXES.get(payload[0], "")
                uri = prefix + payload[1:].decode("utf-8", "replace")
        except Exception:
            notes.append("NDEF URI record present but could not be decoded")
    is_sdm = bool(uri) and any(
        k in uri.lower() for k in ("picc_data", "enc=", "cmac=", "&e=", "&c=", "uid=", "ctr=")
    )
    if is_sdm:
        notes.append("URL carries SDM/SUN mirror parameters")
    return NdefSummary(nlen=nlen, uri=uri, is_sdm_mirror=is_sdm, raw_hex=data[: 2 + nlen].hex().upper(), notes=notes)


# --- File settings / SDM-SUN ----------------------------------------------
@dataclass(frozen=True)
class FileSettings:
    file_no: int
    raw: bytes
    file_type: int
    comm_mode: str            # Plain | MACed | Full (encrypted)
    sdm_enabled: bool
    access_rights_hex: str
    notes: list[str] = field(default_factory=list)


_COMM_MODE = {0x00: "Plain", 0x01: "MACed", 0x03: "Full (encrypted)"}


def parse_file_settings(file_no: int, data: bytes) -> FileSettings | None:
    """Parse a GetFileSettings response. SDM flag = bit 6 of the FileOption byte."""
    if len(data) < 4:
        return None
    file_type = data[0]
    file_option = data[1]
    comm = _COMM_MODE.get(file_option & 0x03, f"0x{file_option & 0x03:02X}")
    sdm_enabled = bool(file_option & 0x40)
    access_rights = data[2:4]
    notes: list[str] = []
    if sdm_enabled:
        notes.append("SDM/SUN mirroring is ENABLED on this file")
    return FileSettings(
        file_no=file_no, raw=data, file_type=file_type, comm_mode=comm,
        sdm_enabled=sdm_enabled, access_rights_hex=access_rights.hex().upper(), notes=notes,
    )


# --- Key versions / ship state --------------------------------------------
@dataclass(frozen=True)
class KeyVersion:
    key_no: int
    version: int  # VERSION byte only — never key material

    @property
    def is_default(self) -> bool:
        # Factory ship-state key version is 0x00 on NTAG 424 DNA.
        return self.version == 0x00


@dataclass(frozen=True)
class KeyConfig:
    keys: list[KeyVersion]

    @property
    def all_default(self) -> bool:
        return bool(self.keys) and all(k.is_default for k in self.keys)

    @property
    def ship_state(self) -> str:
        if not self.keys:
            return "unknown"
        if self.all_default:
            return "factory-default (all key versions 0x00 — UNPERSONALIZED)"
        changed = [k.key_no for k in self.keys if not k.is_default]
        return f"personalized (changed key versions: {changed})"


def parse_key_versions(versions: dict[int, int]) -> KeyConfig:
    keys = [KeyVersion(k, v) for k, v in sorted(versions.items())]
    return KeyConfig(keys=keys)


# --- Crypto mode (AES vs LRP) ---------------------------------------------
def detect_crypto_mode(version: VersionInfo) -> str:
    """NTAG 424 DNA ships in AES mode; LRP is an opt-in personalization choice.

    Public GetVersion does not expose the AES/LRP capability bit directly; LRP
    is only observable post-personalization via the PICC capability data. We
    report AES as the documented default and flag LRP as 'requires config read'.
    """
    return "AES (default; LRP only observable post-personalization)"
