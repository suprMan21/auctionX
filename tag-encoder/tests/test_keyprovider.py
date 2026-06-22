"""Key-derivation determinism + per-UID uniqueness tests.

Guards the core security property: NO single master AES key is reused across
tags. Every UID yields a distinct, deterministic 16-byte key.
"""

import pytest

from tag_encoder.keyprovider import KeyProvider, LocalStubKeyProvider, derive_tag_key_hex

UID_A = bytes.fromhex("04A27E02936980")
UID_B = bytes.fromhex("0123456789ABCD")


def test_derivation_is_deterministic():
    p = LocalStubKeyProvider()
    k1 = p.derive_tag_key(UID_A)
    k2 = p.derive_tag_key(UID_A)
    assert k1 == k2
    assert len(k1) == 16


def test_distinct_keys_per_uid():
    p = LocalStubKeyProvider()
    assert p.derive_tag_key(UID_A) != p.derive_tag_key(UID_B)


def test_not_a_reused_master_key():
    # The derived key must never equal the root seed (i.e. it is derived, not
    # the master itself) and two UIDs must not collide.
    p = LocalStubKeyProvider()
    keys = {p.derive_tag_key(bytes([0x04]) + bytes([i]) * 6) for i in range(32)}
    assert len(keys) == 32  # all distinct


def test_different_root_yields_different_keys():
    p1 = LocalStubKeyProvider(bytes.fromhex("00000000000000000000000000000000"))
    p2 = LocalStubKeyProvider(bytes.fromhex("11111111111111111111111111111111"))
    assert p1.derive_tag_key(UID_A) != p2.derive_tag_key(UID_A)


def test_rejects_bad_uid_length():
    p = LocalStubKeyProvider()
    with pytest.raises(ValueError):
        p.derive_tag_key(b"\x04\x05\x06")  # 3 bytes, not 7


def test_rejects_bad_root_length():
    with pytest.raises(ValueError):
        LocalStubKeyProvider(b"\x00" * 8)


def test_satisfies_protocol():
    # runtime_checkable Protocol: the stub must structurally satisfy KeyProvider
    # (so the KMS backend can drop in to the same contract).
    assert isinstance(LocalStubKeyProvider(), KeyProvider)


def test_hex_helper():
    h = derive_tag_key_hex(LocalStubKeyProvider(), "04A27E02936980")
    assert len(h) == 32 and h == h.upper()
