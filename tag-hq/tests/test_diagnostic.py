"""Diagnostic flow unit tests (no hardware) — Read_Sig SW tolerance regression."""

import pytest

from tag_hq import apdu, genuineness
from tag_hq.diagnostic import _read_signature
from tag_hq.transport import ApduResponse

GOOD_SIG = genuineness.SELFTEST_SIG  # 56 bytes


class FakeTx:
    """Minimal Transport stand-in: maps (CLA,INS) -> ApduResponse."""

    def __init__(self, read_sig_resp: ApduResponse):
        self.atr = b""
        self.reader_name = "fake"
        self._read_sig = read_sig_resp

    def transmit(self, command):
        cla, ins = command[0], command[1]
        if (cla, ins) == (apdu.CLA_NATIVE, apdu.INS_READ_SIG):
            return self._read_sig
        return ApduResponse(b"", 0x90, 0x00)  # SELECT etc. -> 9000


def test_read_sig_accepts_sw_9190_from_real_silicon():
    """Genuine NXP silicon returns 56 bytes + SW 9190 — must be accepted, not discarded."""
    resp = ApduResponse(GOOD_SIG, 0x91, 0x90)
    sig, sw = _read_signature(FakeTx(resp))
    assert sig == GOOD_SIG
    assert sw == "9190"


def test_read_sig_accepts_sw_9100_and_9000():
    for sw1, sw2, hexsw in [(0x91, 0x00, "9100"), (0x90, 0x00, "9000")]:
        sig, sw = _read_signature(FakeTx(ApduResponse(GOOD_SIG, sw1, sw2)))
        assert sig == GOOD_SIG and sw == hexsw


def test_read_sig_rejects_short_error_response():
    """Length/permission errors return no payload and must raise (no silent pass)."""
    resp = ApduResponse(b"", 0x91, 0x7E)  # length error, 0 bytes
    with pytest.raises(RuntimeError):
        _read_signature(FakeTx(resp))
