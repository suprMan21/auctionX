"""S-NFC2 Phase 2 — physical personalisation flow, against the software NTAG 424.

This file pins the v1 flow (key_version=1, UID identity); the v2 flow
(per-chip serial, K1/K4, duplicate UIDs) is in test_personalise_v2.py.

What these prove: stage ordering, refusals before any write, the RETIRED rule,
fail-closed registry, K0-last resume after a mid-encode abort, the read-back
gate before enroll, a phone-tap SUN that verifies as the backend would, and an
audit ledger with no UID / URL / key material.

The secure-messaging bytes themselves are pinned to NXP's vectors in
test_session.py; the emulator shares that code, so it proves flow, not crypto.
"""

from __future__ import annotations

import json

import pytest

from tag_encoder.audit import AuditLog
from tag_encoder.keyprovider import ROLE_APP_MASTER, ROLE_FILE, ROLE_META, LocalKeyProvider
from tag_encoder.ntag424 import apdu as A
from tag_encoder.ntag424.emulator import EmulatedNtag424
from tag_encoder.ntag424.encode import verify_sun
from tag_encoder.personalise import EncodeFailed, EncodeJob, Refused, personalise
from tag_encoder.registry import MemoryRegistry, RegistryError

UID = bytes.fromhex("04A1B2C3D4E5F6")
JOB = EncodeJob(item="item_ph2_001", token="tok_ph2_001", base_url="https://staging.example", key_version=1)
KEYS = LocalKeyProvider(bytes.fromhex("11" * 32), bytes.fromhex("22" * 32), allow_local_keys=True)


def _run(card, registry=None, *, originality=lambda uid, sig: True, audit=None):
    return personalise(
        card, KEYS, registry if registry is not None else MemoryRegistry(), JOB,
        audit=audit or AuditLog(None), originality=originality, mode="emulator",
    )


def _phone_tap(card: EmulatedNtag424) -> tuple[str, str]:
    """What a phone does: select app + NDEF file, read it unauthenticated."""
    card.transmit(A.select_ndef_app())
    card.transmit(A.select_ndef_file())
    data, _ = card.transmit(A.iso_read_binary(0, 0))
    nlen = int.from_bytes(data[:2], "big")
    uri = data[2 : 2 + nlen].decode("ascii", "replace")
    q = uri.split("?", 1)[1]
    params = dict(kv.split("=") for kv in q.split("&"))
    return params["picc_data"], params["cmac"]


def test_factory_chip_is_personalised_read_back_and_enrolled():
    card, reg, audit = EmulatedNtag424(uid=UID), MemoryRegistry(), AuditLog(None)
    out = _run(card, reg, audit=audit)

    assert out.uid_hex == UID.hex().upper() and not out.resumed
    assert reg.rows == {UID.hex().upper(): "ENROLLED"}
    assert out.readback_counter == 1
    # slot map: K0 APP_MASTER, K2 META, K3 FILE; K1/K4 untouched
    assert card.keys[0] == KEYS.derive_key(ROLE_APP_MASTER, 1, UID)
    assert card.keys[2] == KEYS.derive_key(ROLE_META, 1)
    assert card.keys[3] == KEYS.derive_key(ROLE_FILE, 1, UID)
    assert card.keys[1] == card.keys[4] == bytes(16)
    assert card.key_versions == [1, 0, 1, 1, 0]
    # NDEF write is the only plain write and happens under the NEW K0 (proves K0 took)
    assert card.log.count(A.INS_WRITE_DATA) == 1
    assert card.log.index(A.INS_WRITE_DATA) > max(i for i, ins in enumerate(card.log) if ins == A.INS_CHANGE_KEY)
    assert audit.records[-1]["result"] == "encoded" and audit.records[-1]["tag_id"]


def test_phone_tap_after_encode_verifies_like_the_backend():
    card = EmulatedNtag424(uid=UID)
    out = _run(card)
    picc, cmac = _phone_tap(card)
    meta = KEYS.derive_key(ROLE_META, 1)
    res = verify_sun(picc, cmac, meta, lambda uid: KEYS.derive_key(ROLE_FILE, 1, uid), 0, UID.hex())
    assert res.valid and res.counter == out.readback_counter + 1
    # the same tap replayed is rejected
    assert verify_sun(picc, cmac, meta, lambda uid: KEYS.derive_key(ROLE_FILE, 1, uid), res.counter, None).error == "replay_detected"


def test_read_back_url_is_the_template_with_mirrors():
    out = _run(EmulatedNtag424(uid=UID))
    assert out.readback_url.startswith("https://staging.example/verify/tok_ph2_001?picc_data=")
    assert "0" * 32 not in out.readback_url


@pytest.mark.parametrize("status", ["RETIRED", "ENROLLED", "ACTIVE"])
def test_registered_uid_is_refused_before_any_write(status):
    card = EmulatedNtag424(uid=UID)
    reg = MemoryRegistry(rows={UID.hex().upper(): status})
    with pytest.raises(Refused) as exc:
        _run(card, reg)
    assert exc.value.code == ("retired_uid" if status == "RETIRED" else "already_registered")
    assert A.INS_AUTH_EV2_FIRST not in card.log and A.INS_CHANGE_KEY not in card.log
    assert card.keys == [bytes(16)] * 5


def test_registry_outage_fails_closed():
    class Down(MemoryRegistry):
        def precheck(self, uid_hex, *rest):
            raise RegistryError("backend unreachable")

    card = EmulatedNtag424(uid=UID)
    with pytest.raises(Refused) as exc:
        _run(card, Down())
    assert exc.value.code == "registry_unavailable"
    assert A.INS_AUTH_EV2_FIRST not in card.log


def test_tagtamper_silicon_is_refused():
    card = EmulatedNtag424(uid=UID, tag_tamper=True)
    with pytest.raises(Refused) as exc:
        _run(card)
    assert exc.value.code == "tagtamper_or_unknown"
    assert A.INS_AUTH_EV2_FIRST not in card.log


def test_failed_originality_is_refused():
    card = EmulatedNtag424(uid=UID)
    with pytest.raises(Refused) as exc:
        _run(card, originality=lambda uid, sig: False)
    assert exc.value.code == "originality_failed"


def test_default_originality_rejects_the_emulator():
    """The real NXP P-224 check runs by default; a software chip can never pass it."""
    pytest.importorskip("ecdsa")
    card = EmulatedNtag424(uid=UID)
    with pytest.raises(Refused) as exc:
        personalise(card, KEYS, MemoryRegistry(), JOB, audit=AuditLog(None))
    assert exc.value.code == "originality_failed"


def test_chip_keyed_by_someone_else_is_refused():
    card = EmulatedNtag424(uid=UID)
    card.key_versions[0] = 0x42
    with pytest.raises(Refused) as exc:
        _run(card)
    assert exc.value.code == "foreign_keys"


@pytest.mark.parametrize("fail_ins", [A.INS_CHANGE_FILE_SETTINGS, A.INS_CHANGE_KEY, A.INS_WRITE_DATA])
def test_abort_mid_encode_then_rerun_resumes(fail_ins):
    card, reg, audit = EmulatedNtag424(uid=UID, fail_on=fail_ins), MemoryRegistry(), AuditLog(None)
    with pytest.raises(EncodeFailed):
        _run(card, reg, audit=audit)
    assert reg.rows == {}  # never enrolled without a passing read-back
    assert audit.records[-1]["result"] == "failed"

    out = _run(card, reg, audit=audit)  # same chip, second pass
    assert reg.rows == {UID.hex().upper(): "ENROLLED"}
    assert out.resumed == (fail_ins == A.INS_WRITE_DATA)  # K0 already ours only if it failed after K0


def test_abort_between_k2_and_k3_uses_the_right_old_keys_on_rerun():
    card = EmulatedNtag424(uid=UID)
    original = card._change_key
    calls = {"n": 0}

    def flaky(body):
        calls["n"] += 1
        if calls["n"] == 2:  # K2 done, K3 fails
            card._drop_auth()
            return b"", 0x91CA
        return original(body)

    card._change_key = flaky
    with pytest.raises(EncodeFailed):
        _run(card)
    assert card.key_versions == [0, 0, 1, 0, 0]
    card._change_key = original
    out = _run(card)
    assert card.key_versions == [1, 0, 1, 1, 0] and out.readback_counter >= 1


def test_enroll_failure_leaves_a_resumable_chip():
    card = EmulatedNtag424(uid=UID)
    with pytest.raises(EncodeFailed) as exc:
        _run(card, MemoryRegistry(fail_enroll=True))
    assert exc.value.code == "enroll_failed"
    reg = MemoryRegistry()
    out = _run(card, reg)
    assert out.resumed and reg.rows == {UID.hex().upper(): "ENROLLED"}


def test_wrong_keys_never_enroll():
    """A chip personalised under other roots fails read-back verification, so it is never enrolled."""
    card = EmulatedNtag424(uid=UID)
    other = LocalKeyProvider(bytes.fromhex("33" * 32), bytes.fromhex("44" * 32), allow_local_keys=True)
    personalise(card, other, MemoryRegistry(), JOB, audit=AuditLog(None), originality=lambda u, s: True)
    reg = MemoryRegistry()
    with pytest.raises(EncodeFailed) as exc:
        _run(card, reg)  # K0 version matches -> resume path, but our K0 is not the chip's
    assert exc.value.code == "new_master_key_rejected"
    assert reg.rows == {}


def test_audit_ledger_never_holds_uid_url_or_keys(tmp_path):
    path = tmp_path / "audit.jsonl"
    card = EmulatedNtag424(uid=UID)
    _run(card, audit=AuditLog(path))
    with pytest.raises(Refused):
        _run(card, MemoryRegistry(rows={UID.hex().upper(): "RETIRED"}), audit=AuditLog(path))
    text = path.read_text()
    lines = [json.loads(line) for line in text.splitlines()]
    assert [r["result"] for r in lines] == ["encoded", "refused"]
    assert lines[1]["reason"] == "retired_uid"
    for needle in (UID.hex().upper(), UID.hex(), "picc_data", "cmac", "http"):
        assert needle not in text
    for role, uid in ((ROLE_META, None), (ROLE_FILE, UID), (ROLE_APP_MASTER, UID)):
        assert KEYS.derive_key(role, 1, uid).hex() not in text.lower()
    assert oct(path.stat().st_mode & 0o777) == "0o600"


def test_audit_rejects_unlisted_fields():
    with pytest.raises(ValueError):
        AuditLog(None).write(event="personalise", uid="04A1B2C3D4E5F6")


def test_url_too_long_is_refused_before_touching_the_chip():
    card = EmulatedNtag424(uid=UID)
    job = EncodeJob(item="x", token="t" * 300, base_url="https://staging.example", key_version=1)
    with pytest.raises(Refused):
        personalise(card, KEYS, MemoryRegistry(), job, audit=AuditLog(None), originality=lambda u, s: True)
    assert card.log == []
