"""NTAG 424 DNA EV2 secure messaging (AES) — S-NFC2 Phase 2.

Pure, I/O-free. Everything here is pinned to the worked examples in NXP
AN12196 Rev 1.8 (tests/test_session.py):

    Table 14  AuthenticateEV2First: RndB decrypt, RndA||RndB', TI, SV1/SV2,
              SesAuthENCKey / SesAuthMACKey
    Table 8   CommMode.MAC   (GetFileSettings)
    Table 18  CommMode.Full  (WriteData) — IVc, M2 padding, MACt, response MAC
    Table 19  CommMode.Full  (ChangeFileSettings, CmdCtr 1)
    Table 26  ChangeKey case 1 (KeyNo != AuthKey): (Old XOR New) || Ver || CRC32NK
    Table 27  ChangeKey case 2 (KeyNo == AuthKey): New || Ver, no response MAC

Session rules (datasheet §9.1):
  * CmdCtr is 2 bytes little-endian, 0 after AuthenticateEV2First, and is
    incremented after EVERY command/response pair while authenticated —
    including Plain-mode commands.
  * Command MAC  = CMAC(SesAuthMACKey, Cmd || CmdCtr || TI || CmdHeader || [Enc]Data)
    Response MAC = CMAC(SesAuthMACKey, RC || CmdCtr+1 || TI || [Enc]RespData)
    Both truncated to the odd-indexed bytes (1,3,...,15) -> 8 bytes ("MACt").
  * Full mode: IVc = E(SesAuthENCKey, A5 5A || TI || CmdCtr || 0^8),
    IVr = E(SesAuthENCKey, 5A A5 || TI || CmdCtr+1 || 0^8), ISO 9797-1 M2 padding
    (always 0x80 then zeros, a full block if already aligned).

No function here prints, logs or retains key material. Callers zeroize.
"""

from __future__ import annotations

import hmac
import zlib
from dataclasses import dataclass

from ..aes import aes128_cbc_decrypt_nopad, aes128_cbc_encrypt_nopad, aes128_cmac, aes128_encrypt_block

ZERO_IV = bytes(16)
CLA_NATIVE = 0x90


class SecureMessagingError(RuntimeError):
    """The card's response failed authentication (wrong MAC / RndA mismatch)."""


def rotl1(b: bytes) -> bytes:
    return b[1:] + b[:1]


def rotr1(b: bytes) -> bytes:
    return b[-1:] + b[:-1]


def mac_t(key: bytes, data: bytes) -> bytes:
    """AES-CMAC truncated to the odd-indexed bytes (AN12196 'MACt')."""
    full = aes128_cmac(key, data)
    return bytes(full[i] for i in range(1, 16, 2))


def pad_m2(data: bytes) -> bytes:
    """ISO/IEC 9797-1 padding method 2: always append 0x80, then zeros to 16n."""
    padded = data + b"\x80"
    return padded + bytes((-len(padded)) % 16)


def unpad_m2(data: bytes) -> bytes:
    i = data.rstrip(b"\x00")
    if not i or i[-1] != 0x80:
        raise SecureMessagingError("bad M2 padding in decrypted response")
    return i[:-1]


def crc32_nk(data: bytes) -> bytes:
    """NXP CRC32 (DESFire/NTAG): IEEE 802.3 poly, init FFFFFFFF, NO final XOR, LE.

    = bitwise NOT of zlib's CRC32. AN12196 Table 26 step 7 pins it.
    """
    return ((zlib.crc32(data) ^ 0xFFFFFFFF) & 0xFFFFFFFF).to_bytes(4, "little")


# --- AuthenticateEV2First -----------------------------------------------------


def auth_part2(key: bytes, enc_rnd_b: bytes, rnd_a: bytes) -> tuple[bytes, bytes]:
    """From the card's E(K, RndB) and our RndA, return (E(K, RndA || RndB'), RndB)."""
    if len(enc_rnd_b) != 16 or len(rnd_a) != 16:
        raise ValueError("RndB/RndA must be 16 bytes")
    rnd_b = aes128_cbc_decrypt_nopad(key, ZERO_IV, enc_rnd_b)
    return aes128_cbc_encrypt_nopad(key, ZERO_IV, rnd_a + rotl1(rnd_b)), rnd_b


def _sv(prefix: bytes, rnd_a: bytes, rnd_b: bytes) -> bytes:
    # RndA[15:14] || (RndA[13:8] XOR RndB[15:10]) || RndB[9:0] || RndA[7:0]
    # (byte 15 = first byte on the wire)
    xored = bytes(a ^ b for a, b in zip(rnd_a[2:8], rnd_b[0:6]))
    return prefix + rnd_a[0:2] + xored + rnd_b[6:16] + rnd_a[8:16]


def session_keys(key: bytes, rnd_a: bytes, rnd_b: bytes) -> tuple[bytes, bytes]:
    """(SesAuthENCKey, SesAuthMACKey) = CMAC(K, SV1), CMAC(K, SV2)."""
    sv1 = _sv(bytes.fromhex("A55A00010080"), rnd_a, rnd_b)
    sv2 = _sv(bytes.fromhex("5AA500010080"), rnd_a, rnd_b)
    return aes128_cmac(key, sv1), aes128_cmac(key, sv2)


@dataclass
class Session:
    """Live EV2 secure-messaging state. Mutable: cmd_ctr advances per command."""

    key_no: int
    ti: bytes
    enc_key: bytearray
    mac_key: bytearray
    cmd_ctr: int = 0

    def __repr__(self) -> str:  # never show session keys
        return f"Session(key_no={self.key_no}, cmd_ctr={self.cmd_ctr}, <keys redacted>)"

    def zeroize(self) -> None:
        for buf in (self.enc_key, self.mac_key):
            for i in range(len(buf)):
                buf[i] = 0

    def _ctr(self, delta: int = 0) -> bytes:
        return ((self.cmd_ctr + delta) & 0xFFFF).to_bytes(2, "little")

    # -- command side ---------------------------------------------------------

    def iv_cmd(self) -> bytes:
        return aes128_encrypt_block(bytes(self.enc_key), b"\xA5\x5A" + self.ti + self._ctr() + bytes(8))

    def iv_resp(self) -> bytes:
        return aes128_encrypt_block(bytes(self.enc_key), b"\x5A\xA5" + self.ti + self._ctr(1) + bytes(8))

    def cmd_mac(self, cmd: int, header: bytes, data: bytes) -> bytes:
        return mac_t(bytes(self.mac_key), bytes([cmd]) + self._ctr() + self.ti + header + data)

    def wrap_full(self, cmd: int, header: bytes, plain: bytes) -> list[int]:
        """CommMode.Full C-APDU: header || E(SesAuthENC, IVc, plain || M2) || MACt."""
        enc = aes128_cbc_encrypt_nopad(bytes(self.enc_key), self.iv_cmd(), pad_m2(plain))
        body = header + enc + self.cmd_mac(cmd, header, enc)
        return [CLA_NATIVE, cmd, 0x00, 0x00, len(body), *body, 0x00]

    def wrap_mac(self, cmd: int, header: bytes, data: bytes = b"") -> list[int]:
        """CommMode.MAC C-APDU: header || data || MACt."""
        body = header + data + self.cmd_mac(cmd, header, data)
        return [CLA_NATIVE, cmd, 0x00, 0x00, len(body), *body, 0x00]

    # -- response side --------------------------------------------------------

    def check_response(self, rc: int, resp: bytes, *, encrypted: bool = False) -> bytes:
        """Verify a MACed/Full response (data || MACt), advance CmdCtr, return the plain data.

        `rc` is SW2 (0x00 on success). Raises SecureMessagingError on a bad MAC.
        """
        if len(resp) < 8:
            raise SecureMessagingError("response too short to carry a MAC")
        data, got = resp[:-8], resp[-8:]
        want = mac_t(bytes(self.mac_key), bytes([rc]) + self._ctr(1) + self.ti + data)
        if not hmac.compare_digest(got, want):
            raise SecureMessagingError("response MAC mismatch")
        if encrypted and data:
            data = unpad_m2(aes128_cbc_decrypt_nopad(bytes(self.enc_key), self.iv_resp(), data))
        self.cmd_ctr += 1
        return data

    def advance(self) -> None:
        """A Plain-mode command/response completed inside the session."""
        self.cmd_ctr += 1


def finish_auth(key: bytes, key_no: int, rnd_a: bytes, rnd_b: bytes, enc_resp: bytes) -> Session:
    """Decrypt E(K, TI || RndA' || PDcap2 || PCDcap2), check RndA', derive session keys."""
    if len(enc_resp) != 32:
        raise SecureMessagingError("AuthenticateEV2First part 2 response must be 32 bytes")
    plain = aes128_cbc_decrypt_nopad(key, ZERO_IV, enc_resp)
    ti, rnd_a_rot = plain[0:4], plain[4:20]
    if not hmac.compare_digest(rotr1(rnd_a_rot), rnd_a):
        raise SecureMessagingError("card failed mutual authentication (RndA' mismatch)")
    enc_key, mac_key = session_keys(key, rnd_a, rnd_b)
    return Session(key_no=key_no, ti=ti, enc_key=bytearray(enc_key), mac_key=bytearray(mac_key))


# --- ChangeKey cryptogram -------------------------------------------------------


def change_key_plaintext(key_no: int, auth_key_no: int, new_key: bytes, old_key: bytes | None, version: int) -> bytes:
    """Cleartext KeyData for ChangeKey (before Full-mode encryption).

    Case 2 (key_no == auth_key_no): NewKey || KeyVer.
    Case 1 (otherwise):             (OldKey XOR NewKey) || KeyVer || CRC32NK(NewKey).
    """
    if len(new_key) != 16:
        raise ValueError("new_key must be 16 bytes")
    if key_no == auth_key_no:
        return bytes(new_key) + bytes([version & 0xFF])
    if old_key is None or len(old_key) != 16:
        raise ValueError("changing a non-auth key needs the 16-byte old key")
    xored = bytes(a ^ b for a, b in zip(old_key, new_key))
    return xored + bytes([version & 0xFF]) + crc32_nk(new_key)
