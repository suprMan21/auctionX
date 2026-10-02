"""EV2 secure messaging pinned to NXP AN12196 Rev 1.8 worked examples.

These vectors are NXP's, not ours: they are the independent check that the
encoder's live channel matches silicon (the emulator in tests reuses
session.py, so it cannot catch a shared misreading — these can).
"""

from __future__ import annotations

import pytest

from tag_encoder.aes import aes128_cbc_decrypt_nopad
from tag_encoder.ntag424 import session as sm

h = bytes.fromhex


def _session(ti: str, enc: str, mac: str, ctr: int = 0, key_no: int = 0) -> sm.Session:
    return sm.Session(key_no=key_no, ti=h(ti), enc_key=bytearray(h(enc)), mac_key=bytearray(h(mac)), cmd_ctr=ctr)


def test_table14_authenticate_ev2_first():
    key0 = bytes(16)
    rnd_a = h("13C5DB8A5930439FC3DEF9A4C675360F")
    part2, rnd_b = sm.auth_part2(key0, h("A04C124213C186F22399D33AC2A30215"), rnd_a)
    assert rnd_b == h("B9E2FC789B64BF237CCCAA20EC7E6E48")
    assert part2 == h("35C3E05A752E0144BAC0DE51C1F22C56B34408A23D8AEA266CAB947EA8E0118D")

    s = sm.finish_auth(key0, 0, rnd_a, rnd_b, h("3FA64DB5446D1F34CD6EA311167F5E4985B89690C04A05F17FA7AB2F08120663"))
    assert s.ti == h("9D00C4DF") and s.cmd_ctr == 0
    assert bytes(s.enc_key) == h("1309C877509E5A215007FF0ED19CA564")
    assert bytes(s.mac_key) == h("4C6626F5E72EA694202139295C7A7FC7")
    assert "redacted" in repr(s) and "1309" not in repr(s)


def test_table14_rejects_card_that_fails_mutual_auth():
    key0 = bytes(16)
    rnd_a = h("13C5DB8A5930439FC3DEF9A4C675360F")
    _, rnd_b = sm.auth_part2(key0, h("A04C124213C186F22399D33AC2A30215"), rnd_a)
    with pytest.raises(sm.SecureMessagingError):
        sm.finish_auth(key0, 0, bytes(16), rnd_b, h("3FA64DB5446D1F34CD6EA311167F5E4985B89690C04A05F17FA7AB2F08120663"))


def test_table8_commmode_mac():
    s = _session("7A21085E", "00" * 16, "8248134A386E86EB7FAF54A52E536CB6")
    apdu = s.wrap_mac(0xF5, b"\x02")
    assert bytes(apdu) == h("90F5000009026597A457C8CD442C00")
    data = s.check_response(0x00, h("0040EEEE000100D1FE001F00004400004400002000006A00002A474282E7A47986"))
    assert data == h("0040EEEE000100D1FE001F00004400004400002000006A0000")
    assert s.cmd_ctr == 1


def test_table18_commmode_full_write_data():
    s = _session("9D00C4DF", "1309C877509E5A215007FF0ED19CA564", "4C6626F5E72EA694202139295C7A7FC7")
    assert s.iv_cmd() == h("D2CB7277A17841A06654A48188C1F8F5")
    enc = h(
        "421C73A27D827658AF481FDFF20A5025B559D0E3AA21E58D347F343CFFC768BFE596C706BC00F2176781D4B0242642A0"
        "FF5A42C461AAF894D9A1284B8C76BCFA658ACD40555D362E08DB15CF421B51283F9064BCBE20E96CAE545B407C9D651A"
        "3315B27373772E5DA2367D2064AE054AF996C6F1F669170FA88CE8C4E3A4A7BBBEF0FD971FF532C3A802AF745660F2B4"
    )
    # The app note's own step 4 says length 0x53 but its APDU uses 0x80; the
    # ciphertext decrypts to 128 data bytes + one full M2 padding block.
    plain = aes128_cbc_decrypt_nopad(bytes(s.enc_key), s.iv_cmd(), enc)
    assert plain[128:] == b"\x80" + bytes(15)
    apdu = s.wrap_full(0x8D, h("02000000800000"), plain[:128])
    assert bytes(apdu) == h("908D00009F02000000800000") + enc + h("D1D9A8499661EBF300")
    assert s.check_response(0x00, h("FC222E5F7A542452")) == b""
    assert s.cmd_ctr == 1


def test_table19_change_file_settings_at_cmdctr_1():
    s = _session("9D00C4DF", "1309C877509E5A215007FF0ED19CA564", "4C6626F5E72EA694202139295C7A7FC7", ctr=1)
    assert s.iv_cmd() == h("3E27082AB2ACC1EF55C57547934E9962")
    apdu = s.wrap_full(0x5F, b"\x02", h("4000E0C1F121200000430000430000"))
    assert bytes(apdu) == h("905F0000190261B6D97903566E84C3AE5274467E89EAD799B7C1A0EF7A0400")
    s.check_response(0x00, h("57BFF87B1241E93D"))
    assert s.cmd_ctr == 2


def test_table19_bad_response_mac_is_rejected():
    s = _session("9D00C4DF", "1309C877509E5A215007FF0ED19CA564", "4C6626F5E72EA694202139295C7A7FC7", ctr=1)
    with pytest.raises(sm.SecureMessagingError):
        s.check_response(0x00, h("57BFF87B1241E93E"))
    assert s.cmd_ctr == 1  # not advanced on a forged response


def test_table26_change_key_case1_non_auth_key():
    new_key = h("F3847D627727ED3BC9C4CC050489B966")
    assert sm.crc32_nk(new_key) == h("789DFADC")
    plain = sm.change_key_plaintext(0x02, 0x00, new_key, bytes(16), 0x01)
    assert sm.pad_m2(plain) == h("F3847D627727ED3BC9C4CC050489B96601789DFADC8000000000000000000000")
    s = _session("7614281A", "4CF3CB41A22583A61E89B158D252FC53", "5529860B2FC5FB6154B7F28361D30BF9", ctr=2)
    assert s.iv_cmd() == h("307EDE1814707F30CFE603DD6CA62353")
    apdu = s.wrap_full(0xC4, b"\x02", plain)
    assert bytes(apdu) == h(
        "90C4000029022CF362B7BF4311FF3BE1DAA295E8C68DE09050560D19B9E16C2393AE9CD1FAC75D0CE20BCD1D06E600"
    )
    s.check_response(0x00, h("203BB55D1089D587"))
    assert s.cmd_ctr == 3


def test_table27_change_key_case2_auth_key():
    plain = sm.change_key_plaintext(0x00, 0x00, h("5004BF991F408672B1EF00F08F9E8647"), None, 0x01)
    s = _session("7614281A", "4CF3CB41A22583A61E89B158D252FC53", "5529860B2FC5FB6154B7F28361D30BF9", ctr=3)
    assert s.iv_cmd() == h("01602D579423B2797BE8B478B0B4D27B")
    apdu = s.wrap_full(0xC4, b"\x00", plain)
    assert bytes(apdu) == h(
        "90C400002900C0EB4DEEFEDDF0B513A03A95A75491818580503190D4D05053FF75668A01D6FDA6610234BDED643200"
    )


def test_change_key_case1_requires_old_key():
    with pytest.raises(ValueError):
        sm.change_key_plaintext(0x02, 0x00, bytes(16), None, 1)


def test_m2_padding_round_trip():
    assert sm.pad_m2(b"") == b"\x80" + bytes(15)
    assert len(sm.pad_m2(bytes(16))) == 32
    assert sm.unpad_m2(sm.pad_m2(b"\x01\x00")) == b"\x01\x00"


def test_zeroize():
    s = _session("00000000", "11" * 16, "22" * 16)
    s.zeroize()
    assert bytes(s.enc_key) == bytes(16) and bytes(s.mac_key) == bytes(16)
