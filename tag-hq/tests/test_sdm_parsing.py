"""S-NFC3.5 — SDM settings + PICCDataTag decoding (layout only; Tag HQ has no keys).

PICCDataTag cases come from the SHARED vector file also loaded by backend
vitest and tag-encoder pytest: test-vectors/ntag424_sdm_vectors.json.
"""

import json
from pathlib import Path

import pytest

from tag_hq import parsers

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "test-vectors" / "ntag424_sdm_vectors.json").read_text()
)


def test_shared_vector_file_loaded():
    assert "OpenSSL" in VECTORS["_openssl"]
    assert len(VECTORS["piccDataTag"]) >= 6


@pytest.mark.parametrize("v", VECTORS["piccDataTag"], ids=[v["byte"] for v in VECTORS["piccDataTag"]])
def test_picc_data_tag_from_shared_vectors(v):
    tag = parsers.parse_picc_data_tag(int(v["byte"], 16))
    assert tag.uid_mirrored is v["uidMirrored"]
    assert tag.ctr_mirrored is v["ctrMirrored"]
    assert tag.uid_length == v["uidLength"]
    assert tag.acceptable is v["accept"]


def test_golden_vector_plaintext_tag_is_c7_acceptable():
    golden = next(v for v in VECTORS["sdm"] if v["name"] == "an12196_golden_zero_keys")
    tag = parsers.parse_picc_data_tag(bytes.fromhex(golden["piccPlaintext"])[0])
    assert tag.acceptable and tag.uid_length == 7


# FileType 00 | FileOption 40 (SDM, Plain) | AR 00E0 (Read free) | FileSize 000100 (256)
_HEAD = bytes.fromhex("004000E0000100")


def test_encrypted_picc_layout_as_the_encoder_writes_it():
    # SDMOptions C1 | SDMAccessRights 0x23FF LSB-first "FF23" (CtrRet F, Meta K2, File K3)
    # PICCDataOffset 0x20 | MACInputOffset 0x43 | MACOffset 0x43
    data = _HEAD + bytes.fromhex("C1" "FF23" "200000" "430000" "430000")
    fs = parsers.parse_file_settings(0x02, data)
    assert fs.sdm_enabled and fs.file_size == 256
    assert fs.access_rights == {"read": 0xE, "write": 0, "read_write": 0, "change": 0}
    s = fs.sdm
    assert s is not None
    assert s.uid_mirror and s.read_ctr_mirror and s.ascii_encoding
    assert not s.enc_file_data and not s.read_ctr_limit
    assert (s.ctr_ret, s.meta_read, s.file_read) == (0xF, 2, 3)
    assert s.picc_encrypted and s.mac_enabled
    assert s.picc_data_offset == 0x20
    assert s.mac_input_offset == s.mac_offset == 0x43
    assert s.uid_offset is None and s.read_ctr_offset is None
    assert any("ENCRYPTED PICCData under key 2" in n for n in fs.notes)


def test_plain_mirror_layout_is_flagged():
    # The S-NFC2 shape: MetaRead E -> UIDOffset + SDMReadCtrOffset, no PICCDataOffset.
    data = _HEAD + bytes.fromhex("C1" "FFE2" "100000" "200000" "300000" "300000")
    fs = parsers.parse_file_settings(0x02, data)
    s = fs.sdm
    assert s is not None and not s.picc_encrypted
    assert (s.uid_offset, s.read_ctr_offset, s.picc_data_offset) == (0x10, 0x20, None)
    assert (s.mac_input_offset, s.mac_offset) == (0x30, 0x30)
    assert any("PLAIN" in n for n in fs.notes)


def test_enc_file_data_and_ctr_limit_fields():
    # SDMOptions F1 (+ReadCtrLimit +ENCFileData) | 0x23FF | PICC | MACInput | ENCOffset | ENCLength | MAC
    data = _HEAD + bytes.fromhex("F1" "FF23" "200000" "430000" "500000" "200000" "700000" "640000")
    s = parsers.parse_file_settings(0x02, data).sdm
    assert s.enc_file_data and s.read_ctr_limit
    assert (s.enc_offset, s.enc_length, s.mac_offset, s.read_ctr_limit_value) == (0x50, 0x20, 0x70, 100)


def test_mac_off_has_no_mac_offsets():
    data = _HEAD + bytes.fromhex("C1" "FF2F" "200000")  # 0x2FFF: Meta K2, File F (MAC off)
    s = parsers.parse_file_settings(0x02, data).sdm
    assert not s.mac_enabled and s.mac_offset is None and s.picc_data_offset == 0x20


def test_truncated_sdm_block_is_reported_not_raised():
    data = _HEAD + bytes.fromhex("C1" "FF23" "2000")
    fs = parsers.parse_file_settings(0x02, data)
    assert fs.sdm is None
    assert any("truncated" in n for n in fs.notes)


def test_legacy_short_response_still_parses():
    fs = parsers.parse_file_settings(0x02, bytes.fromhex("004000E0"))
    assert fs.sdm_enabled and fs.sdm is None and fs.file_size is None


def test_an12196_table12_get_file_settings():
    """GetFileSettings image built from NXP's ChangeFileSettings body (AN12196 Rev 1.8 Table 19,
    "4000E0C1F121200000430000430000"): SDMAccessRights wire "F1 21" = MetaRead 2, FileRead 1,
    CtrRet 1. Pins the byte order independently of our encoder."""
    fs = parsers.parse_file_settings(0x02, bytes.fromhex("004000E0000100C1F121200000430000430000"))
    s = fs.sdm
    assert s is not None
    assert (s.meta_read, s.file_read, s.ctr_ret) == (2, 1, 1)
    assert s.picc_encrypted and s.picc_data_offset == 0x20
    assert s.mac_input_offset == s.mac_offset == 0x43
