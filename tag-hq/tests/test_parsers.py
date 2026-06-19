"""Parser unit tests built on AN12196 reference vectors and synthetic frames."""

from tag_hq import parsers


# Real captured supplier tag (S-NFC1 first tap 2026-06-18), confirmed genuine
# plain NTAG 424 DNA by DR-9: HW 04 04 02 30 00 11 05, SW 04 04 02 01 02 11 05.
DNA_P1 = bytes.fromhex("04040230001105")
DNA_P2 = bytes.fromhex("04040201021105")
DNA_P3 = bytes.fromhex("04A27E02936980") + bytes.fromhex("CF0CD165304719")  # UID + batch


def test_get_version_accepts_genuine_plain_424dna():
    v = parsers.parse_get_version(DNA_P1, DNA_P2, DNA_P3)
    assert v.is_nxp is True
    assert v.matches_reference is True          # stable tuple, not the 0x08 nibble
    assert v.possible_tt is False               # HW sub-type 0x02 high nibble = 0
    assert v.variant == "NTAG 424 DNA (plain)"
    assert v.uid_hex == "04A27E02936980"
    assert v.sw_subtype == 0x02


def test_get_version_does_not_assert_on_brittle_subtype_nibble():
    """The AN12196 0x08 'strong back modulation' example must ALSO match the tuple."""
    an12196_p1 = bytes.fromhex("04040830001105")  # sub-type 0x08
    v = parsers.parse_get_version(an12196_p1, DNA_P2, DNA_P3)
    assert v.matches_reference is True           # type/storage/sw-subtype/proto unchanged


def test_get_version_flags_off_reference_storage():
    # Wrong storage class (0x0F) -> off-reference, NOT FIT.
    bad_p1 = bytes.fromhex("0404020030 0F05".replace(" ", ""))
    v = parsers.parse_get_version(bad_p1, DNA_P2, DNA_P3)
    assert v.matches_reference is False
    assert v.variant == "NXP, off-reference"
    assert any("reference tuple" in n for n in v.notes)


def test_get_version_flags_possible_tagtamper():
    # HW sub-type high nibble set (0x12) -> possible TagTamper advisory.
    tt_p1 = bytes.fromhex("04041230001105")
    v = parsers.parse_get_version(tt_p1, DNA_P2, DNA_P3)
    assert v.matches_reference is True           # still genuine 424 DNA family
    assert v.possible_tt is True
    assert v.variant == "NTAG 424 DNA (TagTamper?)"


def test_get_version_flags_non_nxp_vendor():
    bad_p1 = bytes.fromhex("99040230001105")
    v = parsers.parse_get_version(bad_p1, DNA_P2, DNA_P3)
    assert v.is_nxp is False
    assert v.matches_reference is False
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
