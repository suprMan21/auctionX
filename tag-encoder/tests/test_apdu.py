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


def test_sdm_payload_has_sdm_flag_and_offsets():
    body = apdu.sdm_file_settings_payload(
        picc_data_offset=0x20, sdm_mac_input_offset=0x40, sdm_mac_offset=0x50
    )
    assert body[0] & 0x40  # FileOption bit6 = SDM enabled
    # SDMOptions byte (index 3) has UID-mirror (bit7) + ReadCtr-mirror (bit6).
    assert body[3] & 0x80 and body[3] & 0x40
    # Offsets are 3-byte little-endian, present at the tail.
    assert body[-9:-6] == (0x20).to_bytes(3, "little")
    assert body[-6:-3] == (0x40).to_bytes(3, "little")
    assert body[-3:] == (0x50).to_bytes(3, "little")


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
        new_key=bytes(range(16)), ndef_bytes=ndef,
        picc_data_offset=0x20, sdm_mac_input_offset=0x40, sdm_mac_offset=0x50,
    )
    names = [s["name"] for s in seq]
    assert names[0].startswith("SELECT NDEF application")
    assert any("AuthenticateEV2First" in n for n in names)
    assert any("ChangeKey" in n for n in names)
    assert any("ChangeFileSettings" in n for n in names)
    assert any("WriteData" in n for n in names)
    assert names[-1].startswith("ReadBinary")
    # The four secure-messaging steps are flagged Phase-2.
    live = [s for s in seq if s.get("requires_live_channel")]
    assert len(live) == 4


def test_write_ins_excluded_from_taghq_readonly_set():
    # Sanity: the encoder's write opcodes are exactly the ones tag-hq forbids.
    assert apdu.INS_CHANGE_KEY == 0xC4
    assert apdu.INS_CHANGE_FILE_SETTINGS == 0x5F
    assert apdu.INS_WRITE_DATA == 0x8D
    assert apdu.INS_AUTH_EV2_FIRST == 0x71
