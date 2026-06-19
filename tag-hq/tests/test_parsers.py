"""Parser unit tests built on AN12196 reference vectors and synthetic frames."""

from tag_hq import parsers


# AN12196 worked-example Gx GetVersion: HW 04 04 08 30 00 11 05, SW 04 04 02 01 01 11 05.
GX_P1 = bytes.fromhex("04040830001105")
GX_P2 = bytes.fromhex("04040201011105")
GX_P3 = bytes.fromhex("04518DFAA96180") + bytes.fromhex("0000000000000000")  # UID + lot/date pad


def test_get_version_identifies_genuine_gx():
    v = parsers.parse_get_version(GX_P1, GX_P2, GX_P3)
    assert v.is_nxp is True
    assert v.is_gx is True
    assert v.variant == "Gx"
    assert v.uid_hex == "04518DFAA96180"
    assert v.prefix14 == parsers.GX_GETVERSION_PREFIX


def test_get_version_flags_non_gx_as_spec_mismatch():
    # Sub-type 0x02 (not 0x08) -> off-spec/Tx flag.
    bad_p1 = bytes.fromhex("04040230001105")
    v = parsers.parse_get_version(bad_p1, GX_P2, GX_P3)
    assert v.is_gx is False
    assert v.variant != "Gx"
    assert any("Gx reference" in n for n in v.notes)


def test_get_version_flags_non_nxp_vendor():
    bad_p1 = bytes.fromhex("99040830001105")
    v = parsers.parse_get_version(bad_p1, GX_P2, GX_P3)
    assert v.is_nxp is False
    assert any("not NXP" in n for n in v.notes)


def test_activation_detects_random_id():
    act = parsers.parse_activation(b"\x3b\x80\x80\x01\x00", bytes.fromhex("08AABBCC"))
    assert act.random_id is True
    assert any("random id" in n.lower() for n in act.notes)


def test_activation_real_uid_not_random():
    act = parsers.parse_activation(b"\x3b\x80\x80\x01\x00", bytes.fromhex("04518DFAA96180"))
    assert act.random_id is False


def test_cc_parse_and_write_lock():
    # 15-byte CC: len 000F, mapping 20, TLV 04 06, ndef id E104, max 0100, R=00 W=FF (locked)
    cc_bytes = bytes.fromhex("000F20000104060005E104010000FF")
    cc = parsers.parse_cc(cc_bytes)
    assert cc is not None
    assert cc.mapping_version == "2.0"
    assert cc.read_only is True


def test_key_versions_ship_state():
    default = parsers.parse_key_versions({0: 0, 1: 0, 2: 0, 3: 0, 4: 0})
    assert default.all_default is True
    assert "UNPERSONALIZED" in default.ship_state

    personalized = parsers.parse_key_versions({0: 1, 1: 0, 2: 0, 3: 0, 4: 0})
    assert personalized.all_default is False
    assert "personalized" in personalized.ship_state


def test_file_settings_sdm_flag():
    # file_type 00, file_option 0x40 (SDM bit set) + comm Plain, access 00E0.
    fs = parsers.parse_file_settings(0x02, bytes.fromhex("004000E0"))
    assert fs is not None
    assert fs.sdm_enabled is True
    assert fs.comm_mode == "Plain"


def test_ndef_uri_extraction():
    # NDEF: NLEN=0011, record D1 01 0D 55 04 'example.com/x' (https:// prefix 04)
    payload = b"\x04" + b"example.com/x"
    record = bytes([0xD1, 0x01, len(payload), 0x55]) + payload
    data = len(record).to_bytes(2, "big") + record
    ndef = parsers.parse_ndef(data)
    assert ndef is not None
    assert ndef.uri == "https://example.com/x"
