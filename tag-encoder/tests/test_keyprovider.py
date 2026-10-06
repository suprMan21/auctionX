"""LocalKeyProvider — role/root separation, refusals, determinism (S-NFC3.5).

Byte-exactness against OpenSSL lives in test_sdm_vectors.py (KDF vectors).
"""

import pytest

from tag_encoder.keyprovider import (
    ROLE_ROOT,
    KeyProvider,
    LocalKeyProvider,
    kdf_message,
)

SDM_ROOT = bytes.fromhex("11" * 32)
ADMIN_ROOT = bytes.fromhex("22" * 32)
UID_A = bytes.fromhex("04A27E02936980")
UID_B = bytes.fromhex("04DE5F1EACC040")
SERIAL_A = bytes.fromhex("5A1E7C0D93B2468F")
SERIAL_B = bytes.fromhex("C3D24B19E0F7A651")


def _p(**kw):
    return LocalKeyProvider(SDM_ROOT, ADMIN_ROOT, allow_local_keys=True, **kw)


def test_refuses_without_explicit_opt_in():
    with pytest.raises(PermissionError):
        LocalKeyProvider(SDM_ROOT, ADMIN_ROOT)


def test_roots_must_be_32_bytes_and_distinct():
    with pytest.raises(ValueError):
        LocalKeyProvider(b"\x00" * 16, ADMIN_ROOT, allow_local_keys=True)
    with pytest.raises(ValueError):
        LocalKeyProvider(SDM_ROOT, SDM_ROOT, allow_local_keys=True)


def test_role_to_root_map():
    assert ROLE_ROOT == {
        "META": "sdm", "FILE": "sdm", "APP_MASTER": "admin", "APP_KEY1": "admin", "APP_KEY4": "admin",
    }


def test_app_master_comes_from_admin_root_only():
    a = LocalKeyProvider(SDM_ROOT, ADMIN_ROOT, allow_local_keys=True).derive_key("APP_MASTER", 1, UID_A)
    b = LocalKeyProvider(bytes.fromhex("33" * 32), ADMIN_ROOT, allow_local_keys=True).derive_key("APP_MASTER", 1, UID_A)
    c = LocalKeyProvider(SDM_ROOT, bytes.fromhex("44" * 32), allow_local_keys=True).derive_key("APP_MASTER", 1, UID_A)
    assert a == b  # SDM root is irrelevant to APP_MASTER
    assert a != c


def test_sdm_roles_come_from_sdm_root_only():
    a = _p().derive_key("FILE", 1, UID_A)
    b = LocalKeyProvider(SDM_ROOT, bytes.fromhex("44" * 32), allow_local_keys=True).derive_key("FILE", 1, UID_A)
    assert a == b


def test_deterministic_and_distinct():
    p = _p()
    assert p.derive_key("FILE", 1, UID_A) == p.derive_key("FILE", 1, UID_A)
    keys = {
        p.derive_key("META", 1),
        p.derive_key("META", 2),
        p.derive_key("FILE", 1, UID_A),
        p.derive_key("FILE", 1, UID_B),
        p.derive_key("FILE", 2, UID_A, SERIAL_A),
        p.derive_key("FILE", 2, UID_A, SERIAL_B),  # same UID, other chip
        p.derive_key("APP_MASTER", 1, UID_A),
        p.derive_key("APP_MASTER", 2, UID_A, SERIAL_A),
    }
    assert len(keys) == 8
    assert all(len(k) == 16 for k in keys)


@pytest.mark.parametrize(
    "role,version,uid",
    [
        ("META", 1, UID_A),        # META takes no UID
        ("FILE", 1, None),         # FILE needs a UID
        ("FILE", 1, b"\x04\x05"),  # wrong UID length
        ("META", 0, None),         # version out of range
        ("META", 256, None),
        ("ROOT", 1, None),         # unknown role
    ],
)
def test_rejects_bad_requests(role, version, uid):
    with pytest.raises(ValueError):
        _p().derive_key(role, version, uid)


@pytest.mark.parametrize(
    "role,version,serial",
    [
        ("FILE", 2, None),            # v2 per-chip keys need the serial
        ("APP_MASTER", 2, b"\x01\x02"),  # wrong serial length
        ("FILE", 1, bytes(8)),        # v1 takes no serial
        ("APP_KEY1", 1, None),        # K1/K4 roles exist from v2
        ("APP_KEY4", 1, None),
    ],
)
def test_rejects_bad_serial_requests(role, version, serial):
    with pytest.raises(ValueError):
        _p().derive_key(role, version, UID_A, serial)


def test_meta_takes_no_serial():
    with pytest.raises(ValueError):
        _p().derive_key("META", 2, None, bytes(8))


def test_spare_keys_come_from_admin_root_only():
    a = _p().derive_key("APP_KEY1", 2, UID_A, SERIAL_A)
    b = LocalKeyProvider(bytes.fromhex("33" * 32), ADMIN_ROOT, allow_local_keys=True).derive_key("APP_KEY1", 2, UID_A, SERIAL_A)
    assert a == b and a != _p().derive_key("APP_KEY4", 2, UID_A, SERIAL_A)


def test_kdf_message_layout():
    assert kdf_message("FILE", 1, UID_A) == b"AM-NTAG424-KDF\x00FILE\x00\x01" + UID_A
    assert kdf_message("FILE", 2, UID_A, SERIAL_A) == b"AM-NTAG424-KDF\x00FILE\x00\x02" + UID_A + SERIAL_A
    assert kdf_message("META", 3) == b"AM-NTAG424-KDF\x00META\x00\x03"


def test_repr_never_shows_roots():
    r = repr(_p())
    assert SDM_ROOT.hex() not in r.lower() and ADMIN_ROOT.hex() not in r.lower()


def test_satisfies_protocol():
    assert isinstance(_p(), KeyProvider)
