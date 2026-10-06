"""S-NFC-ID — v2 personalisation: per-chip serial (KDF v2) and K1/K4 set.

What these prove, on the software NTAG 424:
  * the serial is written onto the chip BEFORE any key is derived from it, so an
    abort at any later step resumes with the same serial (never orphaned keys);
  * every key slot K0..K4 ends up ours (no slot opens with the factory key);
  * two physical chips sharing one UID both encode, get different serials and
    different keys, and a tap from one never verifies as the other;
  * identity at the registry is the signature fingerprint / serial, not the UID;
  * the audit ledger holds neither the UID nor the serial.
"""

from __future__ import annotations

import hashlib
import json

import pytest

from tag_encoder.audit import AuditLog
from tag_encoder.keyprovider import (
    ROLE_APP_KEY1,
    ROLE_APP_KEY4,
    ROLE_APP_MASTER,
    ROLE_FILE,
    ROLE_META,
    LocalKeyProvider,
)
from tag_encoder.ntag424 import apdu as A
from tag_encoder.ntag424.emulator import EmulatedNtag424
from tag_encoder.ntag424.encode import verify_sun
from tag_encoder.personalise import EncodeFailed, EncodeJob, Refused, personalise
from tag_encoder.registry import MemoryRegistry

UID = bytes.fromhex("04A27E02936980")  # the duplicated UID from the 2026-10-05 batch
JOB = EncodeJob(item="item_nfcid_001", token="tok_nfcid_001", base_url="https://staging.example")
KEYS = LocalKeyProvider(bytes.fromhex("11" * 32), bytes.fromhex("22" * 32), allow_local_keys=True)


def _run(card, registry=None, *, audit=None, job=JOB):
    return personalise(
        card, KEYS, registry if registry is not None else MemoryRegistry(), job,
        audit=audit or AuditLog(None), originality=lambda uid, sig: True, mode="emulator",
    )


def _phone_tap(card: EmulatedNtag424) -> dict[str, str]:
    card.transmit(A.select_ndef_app())
    card.transmit(A.select_ndef_file())
    data, _ = card.transmit(A.iso_read_binary(0, 0))
    nlen = int.from_bytes(data[:2], "big")
    uri = data[2 : 2 + nlen].decode("ascii", "replace")
    return dict(kv.split("=") for kv in uri.split("?", 1)[1].split("&"))


def _verify(params: dict[str, str], serial_hex: str, last: int = 0):
    sn = bytes.fromhex(serial_hex)
    return verify_sun(
        params["picc_data"], params["cmac"], KEYS.derive_key(ROLE_META, 2),
        lambda uid: KEYS.derive_key(ROLE_FILE, 2, uid, sn), last, UID.hex(), sn,
    )


def test_job_defaults_to_v2():
    assert JOB.key_version == 2 and JOB.uses_serial


def test_factory_chip_gets_a_serial_and_every_key_slot():
    card, reg = EmulatedNtag424(uid=UID), MemoryRegistry()
    out = _run(card, reg)
    sn = bytes.fromhex(out.serial_hex)

    assert len(out.serial_hex) == 16 and not out.resumed
    assert card.key_versions == [2, 2, 2, 2, 2]
    assert card.keys[0] == KEYS.derive_key(ROLE_APP_MASTER, 2, UID, sn)
    assert card.keys[1] == KEYS.derive_key(ROLE_APP_KEY1, 2, UID, sn)
    assert card.keys[2] == KEYS.derive_key(ROLE_META, 2)
    assert card.keys[3] == KEYS.derive_key(ROLE_FILE, 2, UID, sn)
    assert card.keys[4] == KEYS.derive_key(ROLE_APP_KEY4, 2, UID, sn)
    assert bytes(16) not in card.keys
    assert len(set(card.keys)) == 5
    assert out.readback_url.startswith(f"https://staging.example/verify/tok_nfcid_001?sn={out.serial_hex}&picc_data=")
    # registry row carries the serial and the physical fingerprint
    assert reg.chips == [{
        "uid": UID.hex().upper(), "serial": out.serial_hex,
        "sig": hashlib.sha256(card.signature).hexdigest(), "status": "ENROLLED",
    }]


def test_serial_is_on_the_chip_before_any_key_changes():
    card = EmulatedNtag424(uid=UID)
    _run(card)
    first_write = card.log.index(A.INS_WRITE_DATA)
    assert first_write < card.log.index(A.INS_AUTH_EV2_FIRST)
    assert first_write < card.log.index(A.INS_CHANGE_KEY)
    assert card.settings.mac_in_off < card.settings.picc_off < card.settings.mac_off  # serial is MAC-covered


def test_phone_tap_verifies_only_with_its_own_serial():
    card = EmulatedNtag424(uid=UID)
    out = _run(card)
    params = _phone_tap(card)
    assert params["sn"] == out.serial_hex
    res = _verify(params, out.serial_hex)
    assert res.valid and res.counter == out.readback_counter + 1
    assert _verify(params, "C3D24B19E0F7A651").error == "invalid_signature"
    assert _verify(params, out.serial_hex, res.counter).error == "replay_detected"


def test_duplicate_uid_chips_both_encode_and_stay_distinct():
    reg = MemoryRegistry()
    a, b = EmulatedNtag424(uid=UID), EmulatedNtag424(uid=UID)
    out_a, out_b = _run(a, reg), _run(b, reg)

    assert out_a.serial_hex != out_b.serial_hex
    assert {c["uid"] for c in reg.chips} == {UID.hex().upper()} and len(reg.chips) == 2
    assert a.keys[0] != b.keys[0] and a.keys[3] != b.keys[3]
    assert a.keys[2] == b.keys[2]  # META is fleet-wide by design

    tap_a, tap_b = _phone_tap(a), _phone_tap(b)
    assert _verify(tap_a, out_a.serial_hex).valid and _verify(tap_b, out_b.serial_hex).valid
    # a tap from chip A presented under chip B's serial is not chip B
    assert not _verify(tap_a, out_b.serial_hex).valid
    assert not _verify(tap_b, out_a.serial_hex).valid
    assert reg.precheck(UID.hex(), "00" * 8, "f" * 64).uid_matches == 2


@pytest.mark.parametrize("status", ["ENROLLED", "ACTIVE", "RETIRED"])
def test_same_physical_chip_is_refused_before_any_write(status):
    card = EmulatedNtag424(uid=UID)
    reg = MemoryRegistry(chips=[{
        "uid": UID.hex().upper(), "serial": "AAAAAAAAAAAAAAAA",
        "sig": hashlib.sha256(card.signature).hexdigest(), "status": status,
    }])
    with pytest.raises(Refused) as exc:
        _run(card, reg)
    assert exc.value.code == ("retired_uid" if status == "RETIRED" else "already_registered")
    assert A.INS_WRITE_DATA not in card.log and A.INS_AUTH_EV2_FIRST not in card.log
    assert card.keys == [bytes(16)] * 5


def test_a_v1_row_with_the_same_uid_does_not_block_a_different_chip():
    """chip_001 (v1, UID identity) and its factory-blank twin: the twin encodes at v2."""
    reg = MemoryRegistry(rows={UID.hex().upper(): "ACTIVE"})
    out = _run(EmulatedNtag424(uid=UID), reg)
    assert out.serial_hex and len(reg.chips) == 1


def test_a_v1_encoded_chip_is_refused_by_a_v2_job():
    card = EmulatedNtag424(uid=UID)
    _run(card, job=EncodeJob("i", "t", "https://staging.example", key_version=1))
    with pytest.raises(Refused) as exc:
        _run(card)
    assert exc.value.code == "foreign_keys"


def _flaky_change_key(card: EmulatedNtag424, fail_at: int):
    original = card._change_key
    calls = {"n": 0}

    def flaky(body):
        calls["n"] += 1
        if calls["n"] == fail_at:
            card._drop_auth()
            return b"", 0x91CA
        return original(body)

    card._change_key = flaky
    return original


@pytest.mark.parametrize("fail_at", [1, 2, 3, 4, 5])  # K1, K2, K3, K4, then K0
def test_abort_at_any_change_key_resumes_with_the_same_serial(fail_at):
    card, reg = EmulatedNtag424(uid=UID), MemoryRegistry()
    original = _flaky_change_key(card, fail_at)
    with pytest.raises(EncodeFailed):
        _run(card, reg)
    assert reg.chips == []
    written = _phone_tap(card)["sn"]  # the serial survived the abort

    card._change_key = original
    out = _run(card, reg)
    assert out.serial_hex == written
    assert card.key_versions == [2, 2, 2, 2, 2]
    assert _verify(_phone_tap(card), out.serial_hex, out.readback_counter).valid


@pytest.mark.parametrize("fail_ins", [A.INS_WRITE_DATA, A.INS_CHANGE_FILE_SETTINGS])
def test_abort_at_prewrite_or_settings_then_rerun(fail_ins):
    card, reg = EmulatedNtag424(uid=UID, fail_on=fail_ins), MemoryRegistry()
    with pytest.raises(EncodeFailed):
        _run(card, reg)
    out = _run(card, reg)
    assert len(reg.chips) == 1 and reg.chips[0]["serial"] == out.serial_hex
    assert card.key_versions == [2, 2, 2, 2, 2]


def test_abort_after_k0_resumes_at_the_ndef_stage():
    card, reg = EmulatedNtag424(uid=UID), MemoryRegistry()
    with pytest.raises(EncodeFailed):
        _run(card, MemoryRegistry(fail_enroll=True))
    serial = _phone_tap(card)["sn"]
    out = _run(card, reg)
    assert out.resumed and out.serial_hex == serial and len(reg.chips) == 1


def test_keys_without_a_serial_on_the_chip_fail_closed():
    card = EmulatedNtag424(uid=UID)
    card.key_versions[2] = 2  # a key looks like ours, but there is no serial to derive the rest from
    with pytest.raises(EncodeFailed) as exc:
        _run(card)
    assert exc.value.code == "serial_missing"
    assert A.INS_AUTH_EV2_FIRST not in card.log


def test_audit_ledger_holds_neither_uid_nor_serial(tmp_path):
    path = tmp_path / "audit.jsonl"
    out = _run(EmulatedNtag424(uid=UID), audit=AuditLog(path))
    text = path.read_text()
    assert json.loads(text.splitlines()[-1])["result"] == "encoded"
    for needle in (UID.hex().upper(), UID.hex(), out.serial_hex, out.serial_hex.lower(), "sn=", "http"):
        assert needle not in text
