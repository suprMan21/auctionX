"""The read-only hard line. These tests assert that no write/encode/auth APDU
can ever pass the transport guard — the core S-NFC1 safety constraint.
"""

import pytest

from tag_hq import apdu
from tag_hq.transport import WriteBlockedError, _assert_read_only


# Real NTAG 424 DNA write/encode/auth opcodes that MUST be blocked.
BLOCKED_APDUS = {
    "WriteData":            [0x90, 0x8D, 0x00, 0x00, 0x00],
    "ChangeKey":            [0x90, 0xC4, 0x00, 0x00, 0x00],
    "ChangeFileSettings":   [0x90, 0x5F, 0x00, 0x00, 0x00],
    "AuthEV2First":         [0x90, 0x71, 0x00, 0x00, 0x00],
    "AuthEV2NonFirst":      [0x90, 0x77, 0x00, 0x00, 0x00],
    "AuthLRPFirst":         [0x90, 0x71, 0x01, 0x00, 0x00],  # diff body, same INS still allowed? -> blocked by ALLOWED set
    "ISO_UPDATE_BINARY":    [0x00, 0xD6, 0x00, 0x00, 0x00],
    "SetConfiguration":     [0x90, 0x5C, 0x00, 0x00, 0x00],
    "GetCardUID(auth-only)":[0x90, 0x51, 0x00, 0x00, 0x00],
}


@pytest.mark.parametrize("name,cmd", list(BLOCKED_APDUS.items()))
def test_write_and_auth_apdus_are_blocked(name, cmd):
    with pytest.raises(WriteBlockedError):
        _assert_read_only(cmd)


ALLOWED_APDUS = {
    "SELECT_NDEF_APP":  apdu.SELECT_NDEF_APP,
    "READ_SIG":         apdu.READ_SIG,
    "GET_VERSION_1":    apdu.GET_VERSION_1,
    "GET_VERSION_NEXT": apdu.GET_VERSION_NEXT,
    "SELECT_CC_FILE":   apdu.SELECT_CC_FILE,
    "SELECT_NDEF_FILE": apdu.SELECT_NDEF_FILE,
    "READ_BINARY":      apdu.iso_read_binary(0, 0),
    "GET_FILE_SETTINGS":apdu.get_file_settings(0x02),
    "GET_KEY_VERSION":  apdu.get_key_version(0x00),
    "GET_DATA_UID":     apdu.GET_DATA_UID,
    "GET_DATA_ATS":     apdu.GET_DATA_ATS,
}


@pytest.mark.parametrize("name,cmd", list(ALLOWED_APDUS.items()))
def test_diagnostic_read_apdus_pass(name, cmd):
    # Should not raise.
    _assert_read_only(cmd)


def test_whitelist_contains_no_write_opcodes():
    # Every allowed native command is one of the known read INS bytes.
    read_native_ins = {0x60, 0xAF, 0x3C, 0xF5, 0x64}
    for cla, ins in apdu.ALLOWED:
        if cla == apdu.CLA_NATIVE:
            assert ins in read_native_ins, f"unexpected native INS 0x{ins:02X} in whitelist"


def test_malformed_short_apdu_blocked():
    with pytest.raises(WriteBlockedError):
        _assert_read_only([0x90])
