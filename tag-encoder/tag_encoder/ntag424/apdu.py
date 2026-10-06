"""NTAG 424 DNA WRITE/ENCODE C-APDU builder (S-NFC2 Lane A).

This is the write counterpart to tag-hq's read-only `tag_hq/apdu.py`. It builds
the PLAIN command structures and cleartext bodies for personalisation per NXP
AN12196 / NT4H2421Gx; the live EV2 secure messaging that wraps them is in
`session.py` (pinned to AN12196's worked examples) and the physical sequence
is driven by `tag_encoder/personalise.py`:

    1. ISO SELECT NDEF application (D2760000850101)             [plain]
    2. GetKeyVersion K0/K2/K3 (factory 0x00 vs ours)             [plain]
    3. AuthenticateEV2First (key 0, factory)                    [starts session]
    4. ChangeFileSettings (SDM: encrypted PICCData under K2 +    [Full]
       SDMMAC under K3 into the URL template)
    5. ChangeKey K2 (META), K3 (FILE)                           [Full, case 1]
    6. ChangeKey K0 (APP_MASTER) — LAST, ends the session       [Full, case 2]
    7. AuthenticateEV2First (key 0, NEW) + WriteData NDEF       [Plain file]
    8. GetFileSettings + ISO SELECT NDEF file + ReadBinary      [plain, read-back verify]

Keys are passed to nothing printable — the dry-run sequence carries redacted
layouts only. The three wire-ready "secured" helpers below still raise
`RequiresLiveChannel`: a secured APDU only exists inside a live `Session`.

APDUs are `list[int]` (pyscard transmit() wire format), matching tag-hq.

Sources: AN12196 Rev 1.8 (§5 secure messaging, §6 personalisation example,
Tables 14/19/26/27), NT4H2421Gx datasheet Rev 3.0 §10/§11.
"""

from __future__ import annotations

# Wrapped-native CLA used by NTAG 424 DNA over ISO-DEP.
CLA_NATIVE = 0x90
CLA_ISO = 0x00

# --- Native command (INS) bytes — WRITE/ENCODE set ------------------------
INS_ISO_SELECT_FILE = 0xA4
INS_AUTH_EV2_FIRST = 0x71  # AuthenticateEV2First (part 1)
INS_ADDITIONAL_FRAME = 0xAF  # continue auth / chained frames
INS_CHANGE_KEY = 0xC4
INS_CHANGE_FILE_SETTINGS = 0x5F
INS_WRITE_DATA = 0x8D
INS_ISO_READ_BINARY = 0xB0

# These INS are POWER/WRITE opcodes deliberately excluded from tag-hq's
# read-only whitelist; their presence here is what makes this the encoder.
WRITE_INS: frozenset[int] = frozenset(
    {INS_AUTH_EV2_FIRST, INS_CHANGE_KEY, INS_CHANGE_FILE_SETTINGS, INS_WRITE_DATA}
)

# DF name of the NDEF application.
NDEF_AID = [0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01]

# Standard file numbers on the NDEF app (mirror tag-hq).
FILE_CC = 0x01
FILE_NDEF = 0x02
FILE_PROPRIETARY = 0x03

# Application keys 0..4.
KEY_APP_MASTER = 0x00
KEY_APP_1 = 0x01
KEY_APP_2 = 0x02
KEY_APP_3 = 0x03
KEY_APP_4 = 0x04

# --- S-NFC3.5 key-slot map (AN12196 SDM, encrypted PICCData) ----------------
#   K0  AppMaster        role APP_MASTER, per-UID, ADMIN root (encoder only)
#   K1  spare            v1: left at factory. v2 (S-NFC-ID): APP_KEY1, per-chip, ADMIN root
#   K2  SDMMetaReadKey   role META, fleet-wide, SDM root (decrypts PICCData)
#   K3  SDMFileReadKey   role FILE, per-chip, SDM root (SDM session MAC key)
#   K4  spare            v1: left at factory. v2 (S-NFC-ID): APP_KEY4, per-chip, ADMIN root
SLOT_APP_MASTER = KEY_APP_MASTER
SLOT_SDM_META_READ = KEY_APP_2
SLOT_SDM_FILE_READ = KEY_APP_3
KEY_SLOT_ROLES = {
    SLOT_APP_MASTER: "APP_MASTER",
    KEY_APP_1: "APP_KEY1",
    SLOT_SDM_META_READ: "META",
    SLOT_SDM_FILE_READ: "FILE",
    KEY_APP_4: "APP_KEY4",
}

# Access-condition nibble values (datasheet §8.2.3.3).
ACCESS_FREE = 0xE
ACCESS_NEVER = 0xF


def pack_access_rights(read: int, write: int, read_write: int, change: int) -> bytes:
    """AccessRights, 16 bits = Read(15..12) | Write(11..8) | RW(7..4) | Change(3..0), sent LSB first."""
    for n in (read, write, read_write, change):
        if not (0 <= n <= 0xF):
            raise ValueError("access nibble must be 0..15")
    value = (read << 12) | (write << 8) | (read_write << 4) | change
    return value.to_bytes(2, "little")


def pack_sdm_access_rights(meta_read: int, file_read: int, ctr_ret: int = ACCESS_NEVER) -> bytes:
    """SDMAccessRights, 16 bits = SDMMetaRead(15..12) | SDMFileRead(11..8) | RFU(7..4)=F | SDMCtrRet(3..0), LSB first.

    On the wire: byte0 = RFU|CtrRet, byte1 = MetaRead|FileRead. Pinned by
    AN12196 Rev 1.8 Table 12/19 (MetaRead 2, FileRead 1, CtrRet 1 -> "F1 21").
    S-NFC3.5 had this byte-swapped ("23 FF"); caught in S-NFC2 Ph2 before any
    chip was written.

    SDMMetaRead 0..4 = encrypted PICCData under that key; E = plain UID/ctr
    mirror (what S-NFC2 shipped — rejected for S-NFC3.5); F = no mirror.
    """
    for n in (meta_read, file_read, ctr_ret):
        if not (0 <= n <= 0xF):
            raise ValueError("access nibble must be 0..15")
    value = (meta_read << 12) | (file_read << 8) | (0xF << 4) | ctr_ret
    return value.to_bytes(2, "little")


class RequiresLiveChannel(RuntimeError):
    """Raised when a Phase-2 secured APDU is requested in Phase-1 (SIM) mode."""


# --- Step 1: SELECT NDEF application (plain) -------------------------------

def select_ndef_app() -> list[int]:
    """ISO SELECT the NDEF application by DF name (no secure channel needed)."""
    return [CLA_ISO, INS_ISO_SELECT_FILE, 0x04, 0x0C, len(NDEF_AID), *NDEF_AID, 0x00]


# --- Step 2: AuthenticateEV2First (starts the secure channel) --------------

def authenticate_ev2_first_cmd1(key_no: int = KEY_APP_MASTER) -> list[int]:
    """AuthenticateEV2First part 1 (Cmd 0x71).

    Wire layout (AN12196 §3.3): 90 71 00 00 02 <KeyNo> <LenCap=00> 00.
    The card replies with an encrypted 16-byte RndB challenge (+ 91 AF). The
    full mutual-auth handshake (decrypt RndB, build E(RndA||RndB'), derive
    SesAuthENCKey/SesAuthMACKey) REQUIRES a live channel and live key material
    — Phase 2. This only builds the opening command.
    """
    return [CLA_NATIVE, INS_AUTH_EV2_FIRST, 0x00, 0x00, 0x02, key_no & 0xFF, 0x00, 0x00]


def authenticate_ev2_first_cmd2(enc_rnda_rndb_rot: bytes) -> list[int]:
    """AuthenticateEV2First part 2: 90 AF 00 00 20 <E(RndA||RndB')> 00.

    `enc_rnda_rndb_rot` is the 32-byte AES-CBC encryption of RndA || (RndB<<<8)
    under the auth key. Computing it REQUIRES the live RndB from part 1 and the
    live key — Phase 2. This helper only frames already-computed bytes.
    """
    if len(enc_rnda_rndb_rot) != 32:
        raise ValueError("AuthenticateEV2First part 2 expects 32 enc bytes")
    return [CLA_NATIVE, INS_ADDITIONAL_FRAME, 0x00, 0x00, 0x20, *enc_rnda_rndb_rot, 0x00]


# --- Step 3: ChangeKey (REQUIRES live secure channel) ---------------------

def change_key_plain_payload(key_no: int, new_key: bytes, key_version: int = 0x01) -> bytes:
    """The CLEARTEXT ChangeKey cryptogram body, pre-session-encryption.

    For a non-auth key (changing key N while authenticated with key 0) the body
    is: NewKey(16) || KeyVersion(1) [|| CRC32NK || padding] per AN12196 §4.3.
    For the AUTH key itself it is just NewKey || KeyVersion. The REAL on-wire
    APDU encrypts this under SesAuthENCKey and appends a CMAC under
    SesAuthMACKey — Phase 2. We expose the plaintext body for unit inspection.
    """
    if len(new_key) != 16:
        raise ValueError("new_key must be 16 bytes")
    return bytes(new_key) + bytes([key_version & 0xFF])


def change_key(key_no: int, new_key: bytes, key_version: int = 0x01) -> list[int]:
    """REQUIRES_LIVE_CHANNEL — wire-ready ChangeKey cannot be built in SIM mode."""
    raise RequiresLiveChannel(
        "ChangeKey (0xC4) requires a live EV2 session: build it with "
        "session.Session.wrap_full() over session.change_key_plaintext()."
    )


# --- Step 4: ChangeFileSettings — enable SDM mirroring (REQUIRES channel) --

def sdm_file_settings_payload(
    *,
    picc_data_offset: int,
    sdm_mac_input_offset: int,
    sdm_mac_offset: int,
    sdm_meta_read_key: int = SLOT_SDM_META_READ,
    sdm_file_read_key: int = SLOT_SDM_FILE_READ,
    sdm_ctr_ret: int = ACCESS_NEVER,
) -> bytes:
    """Build the CLEARTEXT ChangeFileSettings body that turns on AN12196 SUN.

    Cleartext layout (datasheet ChangeFileSettings, SDM; S-NFC3.5):

        FileOption       1B  bit6 SDM enabled | bits1..0 CommMode (0 = Plain, so
                             any phone can read the NDEF URL)
        AccessRights     2B  Read=E (free) Write=K0 RW=K0 Change=K0 -> 0xE000, LSB first: 00 E0
        SDMOptions       1B  bit7 UID mirror | bit6 SDMReadCtr mirror | bit0 ASCII
                             (no SDMENCFileData, no ReadCtrLimit)            -> 0xC1
        SDMAccessRights  2B  MetaRead=K2 | FileRead=K3 | RFU=F | CtrRet=F -> 0x23FF, LSB first: FF 23
        PICCDataOffset   3B LE  (present because MetaRead is a key, 0..4: ENCRYPTED
                                 PICCData. No UIDOffset / SDMReadCtrOffset — those
                                 exist only for the plain mirror, MetaRead = E)
        SDMMACInputOffset 3B LE (present because FileRead != F)
        SDMMACOffset      3B LE (present because FileRead != F)

    S-NFC2 shipped MetaRead = 0x0E (PLAIN UID/counter mirror). That leaks the
    UID and counter in clear and is not what the backend verifies; S-NFC3.5
    requires encrypted PICCData under the fleet SDMMetaReadKey (slot K2).
    The wire APDU encrypts this body under the session key — Phase 2.
    """
    if not (0 <= sdm_meta_read_key <= 4):
        raise ValueError("SDMMetaRead must be a key slot 0..4 (encrypted PICCData)")
    if not (0 <= sdm_file_read_key <= 4):
        raise ValueError("SDMFileRead must be a key slot 0..4 (SDMMAC on)")
    if sdm_mac_input_offset > sdm_mac_offset:
        raise ValueError("SDMMACInputOffset must not exceed SDMMACOffset")

    def off3(v: int) -> bytes:
        if not (0 <= v <= 0xFFFFFF):
            raise ValueError("SDM offset must fit in 3 bytes")
        return v.to_bytes(3, "little")

    file_option = 0x40 | 0x00  # SDM enabled, CommMode Plain
    access_rights = pack_access_rights(ACCESS_FREE, KEY_APP_MASTER, KEY_APP_MASTER, KEY_APP_MASTER)
    sdm_options = 0x80 | 0x40 | 0x01  # UID mirror | ReadCtr mirror | ASCII encoding
    sdm_access_rights = pack_sdm_access_rights(sdm_meta_read_key, sdm_file_read_key, sdm_ctr_ret)

    return (
        bytes([file_option])
        + access_rights
        + bytes([sdm_options])
        + sdm_access_rights
        + off3(picc_data_offset)
        + off3(sdm_mac_input_offset)
        + off3(sdm_mac_offset)
    )


def change_file_settings(file_no: int, sdm_payload: bytes) -> list[int]:
    """REQUIRES_LIVE_CHANNEL — wire-ready ChangeFileSettings needs a session."""
    raise RequiresLiveChannel(
        "ChangeFileSettings (0x5F) requires a live EV2 session: build it with "
        "session.Session.wrap_full() over sdm_file_settings_payload()."
    )


# --- Step 5: WriteData (NDEF) — Plain framing + REQUIRES channel for MAC ----

def write_data_plain(file_no: int, offset: int, data: bytes) -> list[int]:
    """WriteData (Cmd 0x8D) framed in PLAIN comm mode.

    Wire layout: 90 8D 00 00 Lc <FileNo><Offset(3B LE)><Length(3B LE)><Data> 00.
    Valid ONLY if the target file's write access is in Plain comm mode. With a
    real personalized SDM file the write is in Full/MACed mode and the data must
    be CMAC'd/encrypted under the session key — see write_data() / Phase 2.
    Provided so a Plain-mode NDEF write (e.g. factory-default tag) is testable.
    """
    if not (0 <= offset <= 0xFFFFFF):
        raise ValueError("offset must fit in 3 bytes")
    length = len(data)
    if not (0 <= length <= 0xFFFFFF):
        raise ValueError("data length must fit in 3 bytes")
    header = [file_no & 0xFF, *offset.to_bytes(3, "little"), *length.to_bytes(3, "little")]
    body = header + list(data)
    return [CLA_NATIVE, INS_WRITE_DATA, 0x00, 0x00, len(body), *body, 0x00]


def write_data(file_no: int, offset: int, data: bytes) -> list[int]:
    """REQUIRES_LIVE_CHANNEL for a MACed/Full file. Use write_data_plain otherwise."""
    raise RequiresLiveChannel(
        "WriteData (0x8D) on a MACed/Full file requires a live EV2 session. Our "
        "NDEF file is CommMode Plain: use write_data_plain() inside the session."
    )


# --- Key state (plain, unauthenticated) ------------------------------------

INS_GET_KEY_VERSION = 0x64


def get_key_version(key_no: int) -> list[int]:
    """GetKeyVersion (Cmd 0x64): returns the key VERSION byte only, never key material.

    Factory keys are version 0x00; the encoder writes the KDF version (1..255),
    which is how a re-run tells a factory chip from one it already keyed.
    """
    return [CLA_NATIVE, INS_GET_KEY_VERSION, 0x00, 0x00, 0x01, key_no & 0xFF, 0x00]


# --- Step 6: read-back verify (plain) -------------------------------------

def select_ndef_file() -> list[int]:
    """ISO SELECT the NDEF file (E104) by file id — plain."""
    return [CLA_ISO, INS_ISO_SELECT_FILE, 0x00, 0x0C, 0x02, 0xE1, 0x04]


def iso_read_binary(offset: int = 0, length: int = 0x00) -> list[int]:
    """ISO READ BINARY at offset; length 0x00 => up to 256 bytes (Le)."""
    return [CLA_ISO, INS_ISO_READ_BINARY, (offset >> 8) & 0xFF, offset & 0xFF, length & 0xFF]


# --- Sequence descriptor (for dry-run / planning) --------------------------

def encode_apdu_sequence(
    *,
    ndef_bytes: bytes,
    picc_data_offset: int,
    sdm_mac_input_offset: int,
    sdm_mac_offset: int,
    key_version: int = 0x01,
    ndef_file_no: int = FILE_NDEF,
    serial_kdf: bool = False,
) -> list[dict]:
    """Describe the personalisation sequence personalise.py runs, for dry-run output.

    Takes NO key material: ChangeKey steps describe their body layout with the
    key bytes REDACTED. Order matches `personalise.py`: SDM settings and the
    non-auth keys (K2, K3; plus K1, K4 with `serial_kdf`) first, K0 LAST (so an
    abort never strands an unknown K0), then the NDEF template under the new K0,
    then a plain read-back. With `serial_kdf` (v2) the template carrying the
    serial is first written unauthenticated, before any key changes.
    """
    change_slots = (
        (KEY_APP_1, SLOT_SDM_META_READ, SLOT_SDM_FILE_READ, KEY_APP_4)
        if serial_kdf
        else (SLOT_SDM_META_READ, SLOT_SDM_FILE_READ)
    )
    redacted = "NewKey(16 B, derived in memory — never printed)"
    steps: list[dict] = [
        {"name": "SELECT NDEF application", "apdu": select_ndef_app(), "requires_live_channel": False},
    ]
    for k in (KEY_APP_MASTER, *sorted(change_slots)):
        steps.append({"name": f"GetKeyVersion K{k}", "apdu": get_key_version(k), "requires_live_channel": False})
    if serial_kdf:
        steps.append({
            "name": f"WriteData (NDEF file {ndef_file_no}, {len(ndef_bytes)}B template with serial) — unauthenticated",
            "plain_framed_apdu": write_data_plain(ndef_file_no, 0, ndef_bytes),
            "note": "factory file 02 is Write=E; the serial is on the chip before any key is derived from it",
            "requires_live_channel": False,
        })
    steps.append({
        "name": f"AuthenticateEV2First (key {KEY_APP_MASTER}, factory) — part 1",
        "apdu": authenticate_ev2_first_cmd1(KEY_APP_MASTER),
        "note": "card replies E(K0, RndB) + 91AF; part 2 = E(K0, RndA || RndB<<8) (session.auth_part2)",
        "requires_live_channel": True,
    })
    sdm_payload = sdm_file_settings_payload(
        picc_data_offset=picc_data_offset,
        sdm_mac_input_offset=sdm_mac_input_offset,
        sdm_mac_offset=sdm_mac_offset,
    )
    steps.append({
        "name": "ChangeFileSettings (SDM: encrypted PICCData K2 + SDMMAC K3)",
        "cleartext_body_hex": sdm_payload.hex().upper(),
        "note": "CommMode.Full under the session keys. Offsets only — no key material.",
        "requires_live_channel": True,
    })
    for slot in change_slots:
        steps.append({
            "name": f"ChangeKey K{slot} ({KEY_SLOT_ROLES[slot]})",
            "cleartext_layout": f"({redacted} XOR OldKey) || KeyVersion({key_version:02X}) || CRC32NK(NewKey)",
            "note": "case 1 (non-auth key); CommMode.Full; skipped if GetKeyVersion shows it already set",
            "requires_live_channel": True,
        })
    steps.append({
        "name": f"ChangeKey K{SLOT_APP_MASTER} (APP_MASTER) — last",
        "cleartext_layout": f"{redacted} || KeyVersion({key_version:02X})",
        "note": "case 2 (auth key): no XOR/CRC, no response MAC; the session ends here",
        "requires_live_channel": True,
    })
    steps.append({
        "name": f"AuthenticateEV2First (key {KEY_APP_MASTER}, NEW) + WriteData (NDEF file {ndef_file_no}, "
                f"{len(ndef_bytes)}B template)",
        "plain_framed_apdu": write_data_plain(ndef_file_no, 0, ndef_bytes),
        "note": "NDEF file is CommMode Plain, Write=K0: plain framing inside the new-K0 session (proves K0)",
        "requires_live_channel": True,
    })
    steps.append({"name": "SELECT NDEF application (drops auth)", "apdu": select_ndef_app(), "requires_live_channel": False})
    steps.append({"name": "GetFileSettings (read-back)", "apdu": [CLA_NATIVE, 0xF5, 0x00, 0x00, 0x01, ndef_file_no, 0x00],
                  "requires_live_channel": False})
    steps.append({"name": "SELECT NDEF file (read-back)", "apdu": select_ndef_file(), "requires_live_channel": False})
    steps.append({"name": "ReadBinary (read-back: SUN must verify before enroll)",
                  "apdu": iso_read_binary(0, len(ndef_bytes)), "requires_live_channel": False})
    return steps
