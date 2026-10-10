"""Encoder auto-naming (Locked 2026-10-09).

What these prove, on the software NTAG 424:
  * with no name the chip is named the next chip_NNN, and that name is in its URL;
  * the name is reserved BEFORE the first write: a clash or a registry outage
    leaves the chip exactly as it was;
  * a manual name goes through the same check;
  * a chip that failed mid-encode keeps its name on the re-run (no burnt names);
  * two encoders working at once never get the same name.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace

import pytest

from tag_encoder.audit import AuditLog
from tag_encoder.keyprovider import LocalKeyProvider
from tag_encoder.ntag424 import apdu as A
from tag_encoder.ntag424.emulator import EmulatedNtag424
from tag_encoder.personalise import EncodeFailed, EncodeJob, Refused, personalise
from tag_encoder.registry import BackendRegistry, MemoryRegistry, NameTaken, RegistryError

AUTO = EncodeJob(item=None, token=None, base_url="https://staging.example")
KEYS = LocalKeyProvider(bytes.fromhex("11" * 32), bytes.fromhex("22" * 32), allow_local_keys=True)
WRITES = {A.INS_WRITE_DATA, A.INS_CHANGE_KEY, A.INS_CHANGE_FILE_SETTINGS}


def _chip(n: int = 1) -> EmulatedNtag424:
    return EmulatedNtag424(uid=bytes.fromhex(f"04A27E029369{n:02X}"))


def _run(card, registry, job=AUTO, audit=None):
    return personalise(
        card, KEYS, registry, job, audit=audit or AuditLog(None), originality=lambda uid, sig: True, mode="emulator",
    )


def _record_writes(card: EmulatedNtag424) -> list[int]:
    seen: list[int] = []
    inner = card.transmit

    def transmit(apdu):
        if apdu[1] in WRITES:
            seen.append(apdu[1])
        return inner(apdu)

    card.transmit = transmit
    return seen


def test_no_name_gets_the_next_chip_number_and_it_is_in_the_url():
    reg = MemoryRegistry()
    first, second = _run(_chip(1), reg), _run(_chip(2), reg)

    assert (first.name, second.name) == ("chip_001", "chip_002")
    assert second.readback_url.startswith(f"https://staging.example/verify/chip_002?sn={second.serial_hex}&")
    assert all(r["enrolled"] for r in reg.names.values())


def test_the_sequence_continues_past_names_already_in_the_registry():
    reg = MemoryRegistry()
    for n, name in enumerate(("chip_001", "chip_004", "gold_run_01"), 1):
        _run(_chip(n), reg, replace(AUTO, item=name, token=name))

    assert _run(_chip(9), reg).name == "chip_005"  # max + 1: a gap is never refilled


def test_a_name_clash_is_refused_before_any_write():
    reg = MemoryRegistry()
    _run(_chip(1), reg, replace(AUTO, item="chip_007", token="chip_007"))
    card = _chip(2)
    writes = _record_writes(card)

    with pytest.raises(Refused) as exc:
        _run(card, reg, replace(AUTO, item="CHIP_007", token="CHIP_007"))  # case does not make it new

    assert exc.value.code == "name_taken" and writes == []
    assert card.key_versions == [0, 0, 0, 0, 0]
    assert len(reg.chips) == 1


def test_a_registry_outage_at_naming_is_refused_before_any_write():
    reg, card = MemoryRegistry(fail_reserve=True), _chip()
    writes = _record_writes(card)

    with pytest.raises(Refused) as exc:
        _run(card, reg)

    assert exc.value.code == "registry_unavailable" and writes == [] and reg.chips == []


@pytest.mark.parametrize("bad", ["has space", "../x", "", "a" * 65, "-lead"])
def test_a_malformed_name_never_reaches_the_chip_or_the_registry(bad):
    reg, card = MemoryRegistry(), _chip()
    writes = _record_writes(card)

    with pytest.raises(Refused):
        _run(card, reg, replace(AUTO, item=bad, token=bad))

    assert writes == [] and reg.names == {}


def test_the_name_is_reserved_before_the_first_write():
    reg, card = MemoryRegistry(), _chip()
    order: list[str] = []
    reserve, inner = reg.reserve_name, card.transmit

    def reserve_name(sig, name=None):
        order.append("reserve")
        return reserve(sig, name)

    def transmit(apdu):
        if apdu[1] in WRITES:
            order.append("write")
        return inner(apdu)

    reg.reserve_name, card.transmit = reserve_name, transmit
    _run(card, reg)

    assert order[0] == "reserve" and "write" in order


def test_a_failed_chip_keeps_its_name_on_the_rerun():
    reg, card = MemoryRegistry(), EmulatedNtag424(uid=bytes.fromhex("04A27E02936980"), fail_on=A.INS_CHANGE_FILE_SETTINGS)
    with pytest.raises(EncodeFailed):
        _run(card, reg)
    assert list(reg.names) == ["chip_001"] and not reg.names["chip_001"]["enrolled"]

    other = _run(_chip(2), reg)  # another chip is encoded in between
    out = _run(card, reg)

    assert (other.name, out.name) == ("chip_002", "chip_001")
    assert "/verify/chip_001?" in out.readback_url


def test_an_unenrolled_chip_can_be_rerun_under_a_new_name():
    reg, card = MemoryRegistry(), EmulatedNtag424(uid=bytes.fromhex("04A27E02936980"), fail_on=A.INS_CHANGE_FILE_SETTINGS)
    with pytest.raises(EncodeFailed):
        _run(card, reg)

    out = _run(card, reg, replace(AUTO, item="gold_run_01", token="gold_run_01"))

    assert out.name == "gold_run_01" and list(reg.names) == ["gold_run_01"]
    assert "/verify/gold_run_01?" in out.readback_url


def test_enroll_refuses_a_name_reserved_for_another_chip():
    reg = MemoryRegistry()
    reg.reserve_name("a" * 64, "chip_001")
    with pytest.raises(RegistryError):
        reg.enroll("04A27E02936980", None, "00" * 8, "b" * 64, 2, "chip_001")


def test_audit_carries_the_assigned_name():
    audit = AuditLog(None)
    _run(_chip(), MemoryRegistry(), audit=audit)
    assert audit.records[-1]["item"] == "chip_001" and audit.records[-1]["token"] == "chip_001"


def test_racing_encoders_never_share_a_name():
    reg = MemoryRegistry()
    with ThreadPoolExecutor(8) as pool:
        names = list(pool.map(lambda n: reg.reserve_name(f"{n:064x}"), range(40)))
    assert len(set(names)) == 40


# --- BackendRegistry.reserve_name: the HTTP contract --------------------------


def _backend(status: int, payload: dict) -> tuple[BackendRegistry, list]:
    reg, calls = BackendRegistry("https://api.example", "jwt"), []

    def call(method, path, body=None):
        calls.append((method, path, body))
        return status, payload

    reg._call = call
    return reg, calls


def test_backend_reserve_asks_for_the_next_name():
    reg, calls = _backend(200, {"success": True, "data": {"name": "chip_005", "auto": True}})
    assert reg.reserve_name("c" * 64) == "chip_005"
    assert calls == [("POST", "/api/v1/nfc/enroll/reserve-name", {"sigSha256": "c" * 64})]


def test_backend_reserve_sends_a_manual_name():
    reg, calls = _backend(200, {"success": True, "data": {"name": "gold_run_01", "auto": False}})
    assert reg.reserve_name("c" * 64, "gold_run_01") == "gold_run_01"
    assert calls[0][2] == {"sigSha256": "c" * 64, "name": "gold_run_01"}


def test_backend_conflict_is_name_taken():
    reg, _ = _backend(409, {"success": False, "error": "That chip name is already in use"})
    with pytest.raises(NameTaken):
        reg.reserve_name("c" * 64, "chip_004")


@pytest.mark.parametrize("status,payload", [
    (500, {}),
    (404, {"error": "Not found"}),  # backend not deployed yet
    (200, {"success": True, "data": {}}),
    (200, {"success": True, "data": {"name": "bad name"}}),
    (200, {"success": False, "data": {"name": "chip_005"}}),
])
def test_backend_reserve_fails_closed(status, payload):
    reg, _ = _backend(status, payload)
    with pytest.raises(RegistryError) as exc:
        reg.reserve_name("c" * 64)
    assert not isinstance(exc.value, NameTaken)


def test_backend_must_echo_the_requested_name():
    reg, _ = _backend(200, {"success": True, "data": {"name": "chip_005"}})
    with pytest.raises(RegistryError):
        reg.reserve_name("c" * 64, "gold_run_01")


def test_enroll_sends_the_chip_name():
    reg, calls = _backend(201, {"success": True, "data": {"tagId": "t-1"}})
    assert reg.enroll("04A27E02936980", None, "00" * 8, "c" * 64, 2, "chip_005") == "t-1"
    assert calls[0][2]["chipName"] == "chip_005"
