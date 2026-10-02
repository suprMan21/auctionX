"""SDM NDEF template + offsets, cross-checked against tag-hq's parsers (S-NFC3.5).

The encoder writes ChangeFileSettings; Tag HQ reads GetFileSettings. The same
SDM block must mean the same thing to both.
"""

from tag_hq import parsers  # pythonpath includes ../tag-hq

from tag_encoder.ntag424 import apdu
from tag_encoder.ntag424.encode import (
    build_sdm_template,
    encode_sun,
    extract_mac_input,
    mirror_into_template,
)

META = bytes.fromhex("8F3B1C2D4E5F60718293A4B5C6D7E8F9")
FILE = bytes.fromhex("0F1E2D3C4B5A69788796A5B4C3D2E1F0")
UID = "04A27E02936980"


def test_offsets_point_at_the_placeholders():
    t = build_sdm_template("https://authentic-materials.com", "item_123")
    assert t.ndef_bytes[t.picc_data_offset : t.picc_data_offset + 32] == b"0" * 32
    assert t.ndef_bytes[t.sdm_mac_offset : t.sdm_mac_offset + 16] == b"0" * 16
    assert t.ndef_bytes[t.picc_data_offset - len("?picc_data=") : t.picc_data_offset] == b"?picc_data="
    assert t.ndef_bytes[t.sdm_mac_offset - len("&cmac=") : t.sdm_mac_offset] == b"&cmac="
    # MAC input range is empty in our layout.
    assert t.sdm_mac_input_offset == t.sdm_mac_offset
    assert extract_mac_input(t.ndef_bytes, t.sdm_mac_input_offset, t.sdm_mac_offset) == b""


def test_chip_mirror_reads_back_as_the_sun_url():
    r = encode_sun(UID, 9, META, FILE, "https://authentic-materials.com", "item 1", "0102030405")
    t = build_sdm_template("https://authentic-materials.com", "item 1")
    mirrored = mirror_into_template(t, bytes.fromhex(r.enc_picc_hex), bytes.fromhex(r.cmac_hex))
    assert mirrored == r.ndef_bytes
    assert parsers.parse_ndef(mirrored).uri == r.sun_url


def test_tag_hq_parses_what_the_encoder_writes():
    t = build_sdm_template("https://authentic-materials.com", "item_123")
    body = apdu.sdm_file_settings_payload(
        picc_data_offset=t.picc_data_offset,
        sdm_mac_input_offset=t.sdm_mac_input_offset,
        sdm_mac_offset=t.sdm_mac_offset,
    )
    # GetFileSettings = FileType || FileOption || AR || FileSize(3) || SDM block;
    # ChangeFileSettings body = FileOption || AR || SDM block.
    response = bytes([0x00]) + body[0:3] + (256).to_bytes(3, "little") + body[3:]
    fs = parsers.parse_file_settings(0x02, response)
    assert fs.sdm_enabled and fs.comm_mode == "Plain"
    assert fs.access_rights == {"read": 0xE, "write": 0, "read_write": 0, "change": 0}
    s = fs.sdm
    assert s.picc_encrypted and s.meta_read == apdu.SLOT_SDM_META_READ
    assert s.mac_enabled and s.file_read == apdu.SLOT_SDM_FILE_READ
    assert s.picc_data_offset == t.picc_data_offset
    assert s.mac_input_offset == t.sdm_mac_input_offset
    assert s.mac_offset == t.sdm_mac_offset
