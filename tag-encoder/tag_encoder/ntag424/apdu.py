"""NTAG 424 DNA WRITE/ENCODE C-APDU builder (S-NFC2 Lane A).

This is the write counterpart to tag-hq's read-only `tag_hq/apdu.py`. It builds
the byte sequences for the full personalization/encode flow per NXP AN12196 /
NT4H2421Gx datasheet EV2 secure messaging:

    1. ISO SELECT NDEF application (D2760000850101)         [plain]
    2. AuthenticateEV2First (AESAuth, key 0)                [starts secure channel]
    3. ChangeKey (set per-tag app key)                      [Full / CMAC session] *
    4. ChangeFileSettings (enable SDM mirroring: UID +      [Full / CMAC session] *
       SDMReadCtr + SDMMAC into the URL template)
    5. WriteData (NDEF file: NLEN || URI record)            [Full / CMAC session] *
    6. ISO SELECT NDEF file + ReadBinary (read-back verify) [plain]

  * Steps 2-5 require a LIVE EV2 secure channel: AuthenticateEV2First does an
    AES challenge/response that yields session keys (SesAuthENCKey /
    SesAuthMACKey); ChangeKey/ChangeFileSettings/WriteData payloads must then be
    encrypted + CMAC'd under those session keys with a per-command counter
    (CmdCtr). Phase 1 (SIM-ONLY) builds the PLAINTEXT command structures and the
    wrapping skeleton; it does NOT compute live session crypto. Each function
    that needs a live channel is marked `REQUIRES_LIVE_CHANNEL` and raises if
    asked to emit a wire-ready secured APDU. See SIM_PARITY.md.

APDUs are `list[int]` (pyscard transmit() wire format), matching tag-hq.

Sources: AN12196 Rev 2.0 (§3 AuthenticateEV2First, §4 ChangeKey,
ChangeFileSettings/SDM, WriteData), NT4H2421Gx datasheet Rev 3.0 §10/§11.
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
        "ChangeKey (0xC4) requires a live EV2 session: payload must be encrypted "
        "under SesAuthENCKey + CMAC'd under SesAuthMACKey (Phase 2). Use "
        "change_key_plain_payload() to inspect the cleartext body."
    )


# --- Step 4: ChangeFileSettings — enable SDM mirroring (REQUIRES channel) --

def sdm_file_settings_payload(
    *,
    comm_mode: int = 0x00,
    sdm_read_ctr: bool = True,
    picc_data_offset: int,
    sdm_mac_offset: int,
    sdm_mac_input_offset: int,
    sdm_meta_read_key: int = 0x0E,
    sdm_file_read_key: int = KEY_APP_2,
) -> bytes:
    """Build the CLEARTEXT ChangeFileSettings body that turns on SDM/SUN.

    Layout (AN12196 §4.5 / datasheet §8.7.2), cleartext form:
        FileOption (SDM flag bit6 set, comm mode in bits0-1)
        AccessRights (2B)
        SDMOptions (UID mirror / ReadCtr mirror / SDMENCFileData flags)
        SDMAccessRights (2B: meta-read key + file-read key nibbles)
        [offsets, little-endian 3B each, present per the SDMOptions flags]:
            PICCDataOffset, SDMMACInputOffset, SDMMACOffset

    The genuine card mirrors UID + SDMReadCtr + SDMMAC into the URL template at
    these byte offsets. The wire APDU encrypts this under the session key —
    Phase 2. This returns the cleartext body for unit tests / inspection.
    """
    file_option = (comm_mode & 0x03) | 0x40  # bit6 = SDM enabled
    access_rights = bytes([0xEE, 0xEE])  # tune in Phase 2

    # SDMOptions: bit7 UID mirror, bit6 SDMReadCtr mirror, bit0 ASCII encoding.
    sdm_options = 0x80 | (0x40 if sdm_read_ctr else 0x00) | 0x01
    sdm_access_rights = bytes([(sdm_meta_read_key << 4) | (sdm_file_read_key & 0x0F), 0xFF])

    def off3(v: int) -> bytes:
        if not (0 <= v <= 0xFFFFFF):
            raise ValueError("SDM offset must fit in 3 bytes")
        return v.to_bytes(3, "little")

    body = bytearray()
    body.append(file_option)
    body += access_rights
    body.append(sdm_options)
    body += sdm_access_rights
    body += off3(picc_data_offset)
    body += off3(sdm_mac_input_offset)
    body += off3(sdm_mac_offset)
    return bytes(body)


def change_file_settings(file_no: int, sdm_payload: bytes) -> list[int]:
    """REQUIRES_LIVE_CHANNEL — wire-ready ChangeFileSettings needs a session."""
    raise RequiresLiveChannel(
        "ChangeFileSettings (0x5F) requires a live EV2 session (encrypt + CMAC "
        "under session keys, Phase 2). Use sdm_file_settings_payload() to inspect "
        "the cleartext body."
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
        "WriteData (0x8D) on a MACed/Full SDM file requires a live EV2 session "
        "(CMAC/encrypt under session keys, Phase 2). For a Plain-mode file use "
        "write_data_plain()."
    )


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
    new_key: bytes,
    ndef_bytes: bytes,
    picc_data_offset: int,
    sdm_mac_input_offset: int,
    sdm_mac_offset: int,
    auth_key_no: int = KEY_APP_MASTER,
    target_key_no: int = KEY_APP_2,
    ndef_file_no: int = FILE_NDEF,
) -> list[dict]:
    """Describe the full encode APDU sequence for dry-run output.

    Each step is a dict: {name, apdu | cleartext_body_hex | plain_framed_apdu,
    note, requires_live_channel}. Steps that require a live EV2 secure channel
    (Phase 2) carry the cleartext body and a note instead of a wire-ready
    secured APDU, so `--dry-run` is fully offline.
    """
    steps: list[dict] = []
    steps.append({
        "name": "SELECT NDEF application",
        "apdu": select_ndef_app(),
        "requires_live_channel": False,
    })
    steps.append({
        "name": f"AuthenticateEV2First (key {auth_key_no}) — cmd1",
        "apdu": authenticate_ev2_first_cmd1(auth_key_no),
        "note": "card replies E(RndB)+91AF; mutual-auth response is Phase 2 (live key)",
        "requires_live_channel": True,
    })
    steps.append({
        "name": f"ChangeKey (key {target_key_no})",
        "cleartext_body_hex": change_key_plain_payload(target_key_no, new_key).hex().upper(),
        "note": "encrypt under SesAuthENCKey + CMAC under SesAuthMACKey (Phase 2)",
        "requires_live_channel": True,
    })
    sdm_payload = sdm_file_settings_payload(
        picc_data_offset=picc_data_offset,
        sdm_mac_input_offset=sdm_mac_input_offset,
        sdm_mac_offset=sdm_mac_offset,
        sdm_file_read_key=target_key_no,
    )
    steps.append({
        "name": "ChangeFileSettings (enable SDM: UID + ReadCtr + SDMMAC mirror)",
        "cleartext_body_hex": sdm_payload.hex().upper(),
        "note": "encrypt + CMAC under session keys (Phase 2)",
        "requires_live_channel": True,
    })
    steps.append({
        "name": f"WriteData (NDEF file {ndef_file_no}, {len(ndef_bytes)}B)",
        "plain_framed_apdu": write_data_plain(ndef_file_no, 0, ndef_bytes),
        "note": "Plain framing shown; MACed/Full file needs session CMAC (Phase 2)",
        "requires_live_channel": True,
    })
    steps.append({
        "name": "SELECT NDEF file (read-back)",
        "apdu": select_ndef_file(),
        "requires_live_channel": False,
    })
    steps.append({
        "name": "ReadBinary (read-back verify)",
        "apdu": iso_read_binary(0, 0x00),
        "requires_live_channel": False,
    })
    return steps
