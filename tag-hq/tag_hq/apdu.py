"""Named C-APDU constants for the READ-ONLY NTAG 424 DNA diagnostic set.

This is the single source of truth for every command Tag HQ is allowed to send.
There are deliberately NO write/encode/auth-key opcodes in this table. The
transport whitelist (transport.py) is derived from ALLOWED_INS so the two can
never drift: if an opcode is not here, it cannot be transmitted.

APDUs are `list[int]` (pyscard's transmit() wire format).

Sources: AN12196 Rev 2.0 (Read_Sig, GetVersion, ISOSelectFile/ReadBinary,
GetFileSettings, GetKeyVersion), NT4H2421Gx datasheet Rev 3.0.
"""

from __future__ import annotations

# Wrapped-native CLA used by NTAG 424 DNA over ISO-DEP (0x90 .. .. .. Lc/Le).
CLA_NATIVE = 0x90
# ISO standard CLA for SELECT / READ BINARY.
CLA_ISO = 0x00

# Native command (INS) bytes — READ ONLY.
INS_GET_VERSION = 0x60      # GetVersion part 1
INS_ADDITIONAL_FRAME = 0xAF  # continue chained response (GetVersion parts 2/3)
INS_READ_SIG = 0x3C        # Read_Sig — originality signature
INS_GET_FILE_SETTINGS = 0xF5  # GetFileSettings — CC/NDEF/proprietary file config + SDM
INS_GET_KEY_VERSION = 0x64  # GetKeyVersion — key VERSION byte only (never key material)
INS_GET_CARD_UID = 0x51    # GetCardUID — only valid post-auth; we never auth, so unused at runtime

# ISO-class command (INS) bytes — READ ONLY.
INS_ISO_SELECT_FILE = 0xA4
INS_ISO_READ_BINARY = 0xB0

# PC/SC reader pseudo-APDU class (0xFF). These never reach the card RF write
# path — they ask the *reader* for activation data it already captured.
CLA_PCSC = 0xFF
INS_GET_DATA = 0xCA  # GET DATA: P1=00 -> UID, P1=01 -> ATS/historical bytes (read-only)

# Whitelist: every (CLA, INS) pair Tag HQ may ever transmit. transport.py
# enforces this. Note: contains zero write opcodes (no WriteData 0x8D, no
# ChangeKey 0xC4, no ChangeFileSettings 0x5F, no auth 0x71/0xAA, etc.).
ALLOWED: frozenset[tuple[int, int]] = frozenset(
    {
        (CLA_ISO, INS_ISO_SELECT_FILE),
        (CLA_ISO, INS_ISO_READ_BINARY),
        (CLA_NATIVE, INS_GET_VERSION),
        (CLA_NATIVE, INS_ADDITIONAL_FRAME),
        (CLA_NATIVE, INS_READ_SIG),
        (CLA_NATIVE, INS_GET_FILE_SETTINGS),
        (CLA_NATIVE, INS_GET_KEY_VERSION),
        (CLA_PCSC, INS_GET_DATA),  # reader GET DATA (UID/ATS) — read-only
    }
)

# --- Concrete APDUs --------------------------------------------------------

# ISO SELECT the NDEF/PICC application by DF name (D2760000850101).
SELECT_NDEF_APP = [0x00, 0xA4, 0x04, 0x0C, 0x07, 0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01, 0x00]

# Read_Sig (Cmd 3Ch, addr 00h) — plain, no auth. -> 56-byte sig + 91 00.
READ_SIG = [0x90, 0x3C, 0x00, 0x00, 0x01, 0x00, 0x00]

# GetVersion 3-part chain. Part 3 carries the 7-byte UID at bytes 0..6.
GET_VERSION_1 = [0x90, 0x60, 0x00, 0x00, 0x00]
GET_VERSION_NEXT = [0x90, 0xAF, 0x00, 0x00, 0x00]

# ISO SELECT Capability Container (E103) and NDEF file (E104) by file id.
SELECT_CC_FILE = [0x00, 0xA4, 0x00, 0x0C, 0x02, 0xE1, 0x03]
SELECT_NDEF_FILE = [0x00, 0xA4, 0x00, 0x0C, 0x02, 0xE1, 0x04]

# Reader GET DATA (PC/SC pseudo-APDU). Read-only: asks the reader for the UID
# / ATS it latched at activation, not a card RF command.
GET_DATA_UID = [0xFF, 0xCA, 0x00, 0x00, 0x00]
GET_DATA_ATS = [0xFF, 0xCA, 0x01, 0x00, 0x00]


def iso_read_binary(offset: int = 0, length: int = 0x00) -> list[int]:
    """ISO READ BINARY at offset. length 0x00 means 'up to 256 bytes' (Le)."""
    return [0x00, 0xB0, (offset >> 8) & 0xFF, offset & 0xFF, length & 0xFF]


def get_file_settings(file_no: int) -> list[int]:
    """GetFileSettings for a given file number (e.g. 0x01 CC, 0x02 NDEF, 0x03 proprietary)."""
    return [0x90, 0xF5, 0x00, 0x00, 0x01, file_no & 0xFF, 0x00]


def get_key_version(key_no: int) -> list[int]:
    """GetKeyVersion — returns the VERSION byte of a key, never key material."""
    return [0x90, 0x64, 0x00, 0x00, 0x01, key_no & 0xFF, 0x00]


# NTAG 424 DNA ships with 5 application keys: 0..4 (App master + 4 app keys).
KEY_NUMBERS = (0x00, 0x01, 0x02, 0x03, 0x04)
# Standard file numbers on the NDEF app.
FILE_CC = 0x01
FILE_NDEF = 0x02
FILE_PROPRIETARY = 0x03
