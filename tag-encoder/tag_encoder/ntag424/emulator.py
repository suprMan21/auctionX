"""Software NTAG 424 DNA (AES mode) — enough of the PICC to rehearse an encode.

Implements the subset the encoder drives: ISOSelect (app / NDEF file),
GetVersion, GetTTStatus (absent on plain stock -> 91 1C), Read_Sig,
GetKeyVersion, GetFileSettings, AuthenticateEV2First, WriteData (Plain file),
ChangeFileSettings (Full), ChangeKey (Full, both cases), ISOReadBinary with
SDM mirroring (encrypted PICCData + SDMMAC, ASCII).

It reuses session.py for the PICC side of secure messaging, so it can NOT
catch a misreading shared with the encoder — that is what the NXP vectors in
tests/test_session.py are for. Its job is the protocol flow: state, access
rights, CmdCtr, ordering, resume, and the read-back mirror.

Never use it to produce anything a customer chip depends on.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from ..aes import aes128_cbc_decrypt_nopad, aes128_cbc_encrypt_nopad
from . import session as sm
from .encode import encrypt_picc_block, sdm_mac

SW_OK_ISO = 0x9000
SW_OK = 0x9100
SW_AF = 0x91AF
SW_ILLEGAL_CMD = 0x911C
SW_INTEGRITY = 0x911E
SW_LENGTH = 0x917E
SW_PERMISSION = 0x919D
SW_PARAM = 0x919E
SW_AUTH = 0x91AE
SW_BOUNDARY = 0x91BE
SW_ISO_SECURITY = 0x6982
SW_ISO_NOT_FOUND = 0x6A82

FREE = 0xE
NEVER = 0xF


@dataclass
class _FileSettings:
    file_option: int = 0x00               # CommMode Plain, SDM off
    read: int = FREE
    write: int = FREE
    read_write: int = FREE
    change: int = 0x0
    size: int = 256
    sdm_options: int = 0
    meta_read: int = NEVER
    file_read: int = NEVER
    ctr_ret: int = NEVER
    picc_off: int = 0
    mac_in_off: int = 0
    mac_off: int = 0

    @property
    def sdm(self) -> bool:
        return bool(self.file_option & 0x40)

    def encode(self) -> bytes:
        ar = ((self.read << 12) | (self.write << 8) | (self.read_write << 4) | self.change).to_bytes(2, "little")
        out = bytes([0x00, self.file_option]) + ar + self.size.to_bytes(3, "little")
        if self.sdm:
            sar = ((self.meta_read << 12) | (self.file_read << 8) | (0xF << 4) | self.ctr_ret).to_bytes(2, "little")
            out += bytes([self.sdm_options]) + sar + self.picc_off.to_bytes(3, "little")
            out += self.mac_in_off.to_bytes(3, "little") + self.mac_off.to_bytes(3, "little")
        return out


@dataclass
class EmulatedNtag424:
    uid: bytes = bytes.fromhex("04A1B2C3D4E5F6")
    tag_tamper: bool = False
    # Read_Sig bytes: per physical chip. Random so two software chips (even with one UID)
    # have different fingerprints, as the duplicate-UID silicon does. Never a valid NXP sig.
    signature: bytes = field(default_factory=lambda: os.urandom(56))
    keys: list[bytes] = field(default_factory=lambda: [bytes(16)] * 5)
    key_versions: list[int] = field(default_factory=lambda: [0] * 5)
    ndef: bytearray = field(default_factory=lambda: bytearray(256))
    settings: _FileSettings = field(default_factory=_FileSettings)
    sdm_read_ctr: int = 0
    fail_on: int | None = None  # INS to fail once with 0x91CA, to rehearse a mid-encode abort

    def __post_init__(self) -> None:
        self._app = False
        self._file: int | None = None
        self._session: sm.Session | None = None
        self._pending: tuple[int, bytes] | None = None
        self._getversion_part = 0
        self.log: list[int] = []  # INS sequence, for tests

    # -- helpers -----------------------------------------------------------

    def _drop_auth(self) -> None:
        if self._session:
            self._session.zeroize()
        self._session = None
        self._pending = None

    def _rnd(self, n: int) -> bytes:
        return os.urandom(n)

    def _auth_ok(self, key_no: int) -> bool:
        if key_no == FREE:
            return True
        return self._session is not None and self._session.key_no == key_no

    def _secured(self, ins: int, body: bytes) -> tuple[bytes, bytes] | int:
        """Check a Full-mode command (header byte + enc + MACt); return (header, plaintext) or an SW."""
        s = self._session
        if s is None:
            return SW_AUTH
        header, enc, mac = body[:1], body[1:-8], body[-8:]
        if s.cmd_mac(ins, header, enc) != mac:
            self._drop_auth()
            return SW_INTEGRITY
        try:
            plain = sm.unpad_m2(aes128_cbc_decrypt_nopad(bytes(s.enc_key), s.iv_cmd(), enc))
        except (sm.SecureMessagingError, ValueError):
            self._drop_auth()
            return SW_INTEGRITY
        return header, plain

    def _mac_reply(self) -> tuple[bytes, int]:
        s = self._session
        assert s is not None
        s.cmd_ctr += 1
        return sm.mac_t(bytes(s.mac_key), b"\x00" + s._ctr() + s.ti), SW_OK

    # -- APDU entry point ------------------------------------------------------

    def transmit(self, apdu: list[int]) -> tuple[bytes, int]:
        cla, ins = apdu[0], apdu[1]
        body = bytes(apdu[5 : 5 + apdu[4]]) if len(apdu) > 5 else b""
        self.log.append(ins)
        if self.fail_on == ins:
            self.fail_on = None
            self._drop_auth()
            return b"", 0x91CA

        if cla == 0xFF and ins == 0xCA:
            return self.uid, SW_OK_ISO
        if cla == 0x00 and ins == 0xA4:
            return self._iso_select(apdu, body)
        if cla == 0x00 and ins == 0xB0:
            return self._iso_read(apdu)
        if cla != 0x90:
            return b"", 0x6E00
        handler = {
            0x60: self._get_version, 0xAF: self._additional_frame, 0xF7: self._get_tt_status,
            0x3C: self._read_sig, 0x64: self._get_key_version, 0xF5: self._get_file_settings,
            0x71: self._auth_first, 0x8D: self._write_data, 0x5F: self._change_file_settings,
            0xC4: self._change_key,
        }.get(ins)
        if handler is None:
            return b"", SW_ILLEGAL_CMD
        return handler(body)

    # -- ISO ---------------------------------------------------------------

    def _iso_select(self, apdu: list[int], body: bytes) -> tuple[bytes, int]:
        if apdu[2] == 0x04 and body == bytes.fromhex("D2760000850101"):
            self._app, self._file = True, None
            self._drop_auth()
            return b"", SW_OK_ISO
        if apdu[2] == 0x00 and body == b"\xE1\x04" and self._app:
            self._file = 0x02
            return b"", SW_OK_ISO
        return b"", SW_ISO_NOT_FOUND

    def _iso_read(self, apdu: list[int]) -> tuple[bytes, int]:
        if self._file != 0x02:
            return b"", SW_ISO_NOT_FOUND
        if not self._auth_ok(self.settings.read):
            return b"", SW_ISO_SECURITY
        offset = (apdu[2] << 8) | apdu[3]
        length = apdu[4] or 256
        image = bytearray(self.ndef)
        st = self.settings
        if st.sdm and self._session is None:
            self.sdm_read_ctr += 1
            ctr_le = self.sdm_read_ctr.to_bytes(3, "little")
            picc = bytes([0xC7]) + self.uid + ctr_le + self._rnd(5)
            enc = encrypt_picc_block(picc, self.keys[st.meta_read])
            # The PICCData mirror lands first: the MAC input range covers the
            # MIRRORED bytes (AN12196: e.g. "<ENCPICCData>&cmac=").
            image[st.picc_off : st.picc_off + 32] = enc.hex().upper().encode("ascii")
            mac = sdm_mac(self.keys[st.file_read], self.uid, ctr_le, bytes(image[st.mac_in_off : st.mac_off]))
            image[st.mac_off : st.mac_off + 16] = mac.hex().upper().encode("ascii")
        return bytes(image[offset : offset + length]), SW_OK_ISO

    # -- native, unauthenticated -------------------------------------------------

    def _get_version(self, body: bytes) -> tuple[bytes, int]:
        self._getversion_part = 1
        return bytes.fromhex("04040230001105"), SW_AF

    def _additional_frame(self, body: bytes) -> tuple[bytes, int]:
        if self._pending is not None:
            return self._auth_part2(body)
        if self._getversion_part == 1:
            self._getversion_part = 2
            return bytes.fromhex("04040201021105"), SW_AF
        if self._getversion_part == 2:
            self._getversion_part = 0
            return self.uid + bytes.fromhex("CF39D449904120"), SW_OK
        return b"", SW_PERMISSION

    def _get_tt_status(self, body: bytes) -> tuple[bytes, int]:
        return (bytes(5), SW_OK) if self.tag_tamper else (b"", SW_ILLEGAL_CMD)

    def _read_sig(self, body: bytes) -> tuple[bytes, int]:
        return self.signature, 0x9190  # not an NXP signature: emulator chips are never "genuine"

    def _get_key_version(self, body: bytes) -> tuple[bytes, int]:
        if not body or body[0] > 4:
            return b"", SW_PARAM
        return bytes([self.key_versions[body[0]]]), SW_OK

    def _get_file_settings(self, body: bytes) -> tuple[bytes, int]:
        if body[:1] != b"\x02":
            return b"", SW_PARAM
        return self.settings.encode(), SW_OK

    # -- AuthenticateEV2First -----------------------------------------------------

    def _auth_first(self, body: bytes) -> tuple[bytes, int]:
        self._drop_auth()
        key_no = body[0]
        if key_no > 4:
            return b"", SW_PARAM
        rnd_b = self._rnd(16)
        self._pending = (key_no, rnd_b)
        return aes128_cbc_encrypt_nopad(self.keys[key_no], sm.ZERO_IV, rnd_b), SW_AF

    def _auth_part2(self, body: bytes) -> tuple[bytes, int]:
        key_no, rnd_b = self._pending  # type: ignore[misc]
        self._pending = None
        key = self.keys[key_no]
        plain = aes128_cbc_decrypt_nopad(key, sm.ZERO_IV, body)
        rnd_a, rnd_b_rot = plain[:16], plain[16:]
        if rnd_b_rot != sm.rotl1(rnd_b):
            return b"", SW_AUTH
        ti = self._rnd(4)
        enc_key, mac_key = sm.session_keys(key, rnd_a, rnd_b)
        self._session = sm.Session(key_no=key_no, ti=ti, enc_key=bytearray(enc_key), mac_key=bytearray(mac_key))
        resp = aes128_cbc_encrypt_nopad(key, sm.ZERO_IV, ti + sm.rotl1(rnd_a) + bytes(12))
        return resp, SW_OK

    # -- writes ----------------------------------------------------------------------

    def _write_data(self, body: bytes) -> tuple[bytes, int]:
        if body[0] != 0x02:
            return b"", SW_PARAM
        if self.settings.file_option & 0x03:
            return b"", SW_PERMISSION  # only Plain files are emulated for WriteData
        offset = int.from_bytes(body[1:4], "little")
        length = int.from_bytes(body[4:7], "little")
        data = body[7:]
        if len(data) != length:
            return b"", SW_LENGTH
        if offset + length > self.settings.size:
            return b"", SW_BOUNDARY
        if not (self._auth_ok(self.settings.write) or self._auth_ok(self.settings.read_write)):
            return b"", SW_PERMISSION
        self.ndef[offset : offset + length] = data
        if self._session:
            self._session.cmd_ctr += 1
        return b"", SW_OK

    def _change_file_settings(self, body: bytes) -> tuple[bytes, int]:
        if not self._auth_ok(self.settings.change):
            return b"", SW_PERMISSION
        res = self._secured(0x5F, body)
        if isinstance(res, int):
            return b"", res
        header, p = res
        if header != b"\x02" or len(p) < 3:
            return b"", SW_PARAM
        new = _FileSettings(size=self.settings.size)
        new.file_option = p[0]
        ar = int.from_bytes(p[1:3], "little")
        new.read, new.write, new.read_write, new.change = ar >> 12 & 0xF, ar >> 8 & 0xF, ar >> 4 & 0xF, ar & 0xF
        if new.sdm:
            new.sdm_options = p[3]
            sar = int.from_bytes(p[4:6], "little")
            new.meta_read, new.file_read, rfu, new.ctr_ret = sar >> 12 & 0xF, sar >> 8 & 0xF, sar >> 4 & 0xF, sar & 0xF
            # Only the layout the encoder writes: encrypted PICCData + SDMMAC, no ENCFileData / limit.
            if rfu != 0xF or not (new.meta_read <= 4 and new.file_read <= 4) or new.sdm_options != 0xC1:
                return b"", SW_PARAM
            if len(p) != 15:
                return b"", SW_LENGTH
            new.picc_off = int.from_bytes(p[6:9], "little")
            new.mac_in_off = int.from_bytes(p[9:12], "little")
            new.mac_off = int.from_bytes(p[12:15], "little")
            if new.mac_in_off > new.mac_off or new.mac_off + 16 > new.size or new.picc_off + 32 > new.size:
                return b"", SW_BOUNDARY
        self.settings = new
        return self._mac_reply()

    def _change_key(self, body: bytes) -> tuple[bytes, int]:
        s = self._session
        if s is None or s.key_no != 0:
            return b"", SW_PERMISSION
        res = self._secured(0xC4, body)
        if isinstance(res, int):
            return b"", res
        header, p = res
        key_no = header[0]
        if key_no > 4:
            return b"", SW_PARAM
        if key_no == s.key_no:
            self.keys[key_no], self.key_versions[key_no] = p[:16], p[16]
            self._drop_auth()  # changing the auth key ends the session; no response MAC
            return b"", SW_OK
        new = bytes(a ^ b for a, b in zip(p[:16], self.keys[key_no]))
        if sm.crc32_nk(new) != p[17:21]:
            return b"", SW_INTEGRITY
        self.keys[key_no], self.key_versions[key_no] = new, p[16]
        return self._mac_reply()
