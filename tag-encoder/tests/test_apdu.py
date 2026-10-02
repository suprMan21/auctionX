"""APDU builder tests — fixed wire vectors + Phase-2 guardrails."""

import pytest

from tag_encoder.ndef import build_ndef_uri_file
from tag_encoder.ntag424 import apdu


def test_select_ndef_app_vector():
    # Matches tag-hq's SELECT_NDEF_APP exactly (same AID D2760000850101).
    assert apdu.select_ndef_app() == [
        0x00, 0xA4, 0x04, 0x0C, 0x07, 0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01, 0x00
    ]


def test_select_ndef_file_vector():
    assert apdu.select_ndef_file() == [0x00, 0xA4, 0x00, 0x0C, 0x02, 0xE1, 0x04]


def test_authenticate_ev2_first_cmd1_vector():
    # 90 71 00 00 02 <KeyNo=00> 00 00
    assert apdu.authenticate_ev2_first_cmd1(0x00) == [0x90, 0x71, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]


def test_authenticate_ev2_first_cmd2_frames_32_bytes():
    payload = bytes(range(32))
    out = apdu.authenticate_ev2_first_cmd2(payload)
    assert out[:5] == [0x90, 0xAF, 0x00, 0x00, 0x20]
    assert out[5:5 + 32] == list(payload)
    assert out[-1] == 0x00
    with pytest.raises(ValueError):
        apdu.authenticate_ev2_first_cmd2(bytes(16))  # wrong length


def test_change_key_plain_payload_is_key_plus_version():
    key = bytes(range(16))
    body = apdu.change_key_plain_payload(0x02, key, 0x01)
    assert body == key + bytes([0x01])


def test_sdm_payload_exact_byte_layout():
    """S-NFC3.5: encrypted PICCData under K2, SDMMAC under K3 — every byte pinned."""
    body = apdu.sdm_file_settings_payload(
        picc_data_offset=0x20, sdm_mac_input_offset=0x43, sdm_mac_offset=0x43
    )
    assert body.hex().upper() == (
        "40"        # FileOption: SDM enabled, CommMode Plain
        "00E0"      # AccessRights 0xE000 LSB first: Read=E Write=K0 RW=K0 Change=K0
        "C1"        # SDMOptions: UID mirror | ReadCtr mirror | ASCII
        "23FF"      # SDMAccessRights 0xFF23 LSB first: RFU F, CtrRet F, MetaRead K2, FileRead K3
        "200000"    # PICCDataOffset (encrypted PICCData -> no UIDOffset/ReadCtrOffset)
        "430000"    # SDMMACInputOffset
        "430000"    # SDMMACOffset (== input offset -> empty MAC input)
    )


def test_sdm_meta_read_is_a_key_not_plain_mirror():
    body = apdu.sdm_file_settings_payload(picc_data_offset=1, sdm_mac_input_offset=2, sdm_mac_offset=2)
    meta_read = (int.from_bytes(body[4:6], "little") >> 4) & 0xF
    assert meta_read == apdu.SLOT_SDM_META_READ == 2
    with pytest.raises(ValueError):  # 0x0E = plain UID/ctr mirror, the S-NFC2 bug
        apdu.sdm_file_settings_payload(
            picc_data_offset=1, sdm_mac_input_offset=2, sdm_mac_offset=2, sdm_meta_read_key=0x0E
        )
    with pytest.raises(ValueError):
        apdu.sdm_file_settings_payload(picc_data_offset=1, sdm_mac_input_offset=3, sdm_mac_offset=2)


def test_access_rights_packing():
    assert apdu.pack_access_rights(0xE, 0x0, 0x0, 0x0) == bytes.fromhex("00E0")
    assert apdu.pack_access_rights(0x1, 0x2, 0x3, 0x4) == bytes.fromhex("3412")
    assert apdu.pack_sdm_access_rights(2, 3) == bytes.fromhex("23FF")
    assert apdu.pack_sdm_access_rights(2, 3, ctr_ret=1) == bytes.fromhex("23F1")
    with pytest.raises(ValueError):
        apdu.pack_access_rights(0x10, 0, 0, 0)


def test_key_slot_map():
    assert apdu.KEY_SLOT_ROLES == {0: "APP_MASTER", 2: "META", 3: "FILE"}


def test_write_data_plain_framing():
    data = b"\x00\x10" + b"\xAA" * 16
    out = apdu.write_data_plain(0x02, 0, data)
    assert out[0] == 0x90 and out[1] == 0x8D
    lc = out[4]
    body = out[5 : 5 + lc]
    assert body[0] == 0x02                       # file no
    assert body[1:4] == [0x00, 0x00, 0x00]       # offset 0 (LE)
    assert body[4:7] == list(len(data).to_bytes(3, "little"))
    assert body[7:] == list(data)
    assert out[-1] == 0x00                        # Le


@pytest.mark.parametrize("fn", ["change_key", "change_file_settings", "write_data"])
def test_secured_writes_require_live_channel(fn):
    with pytest.raises(apdu.RequiresLiveChannel):
        if fn == "change_key":
            apdu.change_key(0x02, bytes(16))
        elif fn == "change_file_settings":
            apdu.change_file_settings(0x02, b"\x00")
        else:
            apdu.write_data(0x02, 0, b"\x00")


def test_encode_sequence_shape_and_live_flags():
    ndef = build_ndef_uri_file("https://t.co/verify/x?picc_data=AB&cmac=CD")
    seq = apdu.encode_apdu_sequence(
        ndef_bytes=ndef, picc_data_offset=0x20, sdm_mac_input_offset=0x43, sdm_mac_offset=0x43,
    )
    names = [s["name"] for s in seq]
    assert names[0].startswith("SELECT NDEF application")
    assert any("AuthenticateEV2First" in n for n in names)
    assert any("ChangeFileSettings" in n for n in names)
    assert any("WriteData" in n for n in names)
    assert names[-1].startswith("ReadBinary")
    # K2 (META) and K3 (FILE) change before K0, and K0 (the auth key) changes last.
    change_keys = [n for n in names if n.startswith("ChangeKey")]
    assert change_keys == ["ChangeKey K2 (META)", "ChangeKey K3 (FILE)", "ChangeKey K0 (APP_MASTER) — last"]
    assert names.index(change_keys[-1]) > names.index(next(n for n in names if "WriteData" in n))
    # Auth + 3 ChangeKey + ChangeFileSettings + WriteData need a live channel.
    live = [s for s in seq if s.get("requires_live_channel")]
    assert len(live) == 6


def test_encode_sequence_carries_no_key_material():
    """S-NFC3.5: the sequence takes no keys, and ChangeKey bodies are redacted layouts."""
    import inspect

    assert "new_key" not in inspect.signature(apdu.encode_apdu_sequence).parameters
    ndef = build_ndef_uri_file("https://t.co/verify/x?picc_data=AB&cmac=CD")
    seq = apdu.encode_apdu_sequence(
        ndef_bytes=ndef, picc_data_offset=0x20, sdm_mac_input_offset=0x43, sdm_mac_offset=0x43,
    )
    for step in (s for s in seq if s["name"].startswith("ChangeKey")):
        assert "cleartext_body_hex" not in step
        assert "never printed" in step["cleartext_layout"]


def test_write_ins_excluded_from_taghq_readonly_set():
    # Sanity: the encoder's write opcodes are exactly the ones tag-hq forbids.
    assert apdu.INS_CHANGE_KEY == 0xC4
    assert apdu.INS_CHANGE_FILE_SETTINGS == 0x5F
    assert apdu.INS_WRITE_DATA == 0x8D
    assert apdu.INS_AUTH_EV2_FIRST == 0x71
