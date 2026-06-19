"""Pure parsers for NTAG 424 DNA diagnostic data. No I/O — bytes in, dataclasses out.

Kept side-effect-free so S-NFC2 can reuse them and so they unit-test without
hardware. Sources: AN12196 Rev 2.0, NT4H2421Gx datasheet Rev 3.0 §8/§10.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# Gx GetVersion reference (HW+SW prefix, first 14 bytes) — LOCKED in Decisions DB.
GX_GETVERSION_PREFIX = bytes.fromhex("0404083000110504040201011105")
NXP_VENDOR_ID = 0x04


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
    uid: bytes  # 7 bytes; INVALID if random_id is True
    prefix14: bytes
    is_gx: bool
    is_nxp: bool
    variant: str  # "Gx" | "Tx?" | "off-spec"
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

    uid = p3[0:7] if len(p3) >= 7 else p3
    prefix14 = (p1[:7] + p2[:7]) if (len(p1) >= 7 and len(p2) >= 7) else b""

    is_nxp = vendor == NXP_VENDOR_ID
    is_gx = prefix14 == GX_GETVERSION_PREFIX
    if not is_nxp:
        notes.append(f"vendor 0x{vendor:02X} is not NXP (0x04)")

    if is_gx:
        variant = "Gx"
    elif is_nxp and hw_subtype != 0x08:
        # Tx (TagTamper) and other variants differ in sub-type/SW; we cannot
        # positively ID Tx from public tables, so flag rather than assert.
        variant = "Tx?/off-spec"
        notes.append("GetVersion prefix != Gx reference — off-spec or Tx variant (rejected hardware)")
    else:
        variant = "off-spec"
        notes.append("GetVersion prefix does not match Gx reference")

    return VersionInfo(
        raw=raw, vendor_id=vendor, hw_type=hw_type, hw_subtype=hw_subtype,
        hw_major=hw_major, hw_minor=hw_minor, storage_size=storage, protocol=protocol,
        sw_type=sw_type, uid=uid, prefix14=prefix14, is_gx=is_gx, is_nxp=is_nxp,
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
