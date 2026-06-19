"""GATING self-test for the §3 originality check.

If the AN12196 Table 30 vector does not verify, the key/curve/decode wiring is
wrong and NO field read can be trusted. The Tag HQ server refuses to start
unless this passes (see server.py startup guard).
"""

import pytest

from tag_hq import genuineness as g


def test_an12196_table30_vector_verifies():
    """The locked Table 30 (UID, sig) pair MUST verify as genuine."""
    result = g.run_selftest()
    assert result.genuine is True, result.reason
    assert result.uid_hex == "04518DFAA96180"
    assert result.label == "genuine NXP silicon"


def test_locked_curve_is_p224_not_p128():
    """Guard against the classic NTAG-21x secp128r1 carryover mistake."""
    from ecdsa import NIST224p

    assert g._VK.curve is NIST224p
    # P-224 public point is 2*28 = 56 bytes uncompressed X||Y.
    assert len(g.NXP_PUB_XY) == 56


def test_tampered_signature_fails():
    """Flipping one signature byte must fail (no silent pass-through)."""
    bad = bytearray(g.SELFTEST_SIG)
    bad[0] ^= 0x01
    result = g.verify_originality(g.SELFTEST_UID, bytes(bad))
    assert result.genuine is False
    assert result.label == "NOT verified as NXP silicon"


def test_wrong_uid_fails():
    """A genuine signature against the wrong UID must fail."""
    other_uid = bytes.fromhex("04000000000000")
    result = g.verify_originality(other_uid, g.SELFTEST_SIG)
    assert result.genuine is False


@pytest.mark.parametrize(
    "uid,sig,needle",
    [
        (b"\x04\x51", g.SELFTEST_SIG, "UID must be 7 bytes"),
        (g.SELFTEST_UID, g.SELFTEST_SIG[:40], "signature must be 56 bytes"),
    ],
)
def test_malformed_inputs_are_rejected_not_crashed(uid, sig, needle):
    result = g.verify_originality(uid, sig)
    assert result.genuine is False
    assert needle in result.reason
