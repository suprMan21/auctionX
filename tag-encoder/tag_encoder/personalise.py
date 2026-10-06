"""Physical personalisation of one NTAG 424 DNA chip — S-NFC2 Phase 2.

Order (every stage must pass before the next; nothing is written until
the serial stage):

  1 identify     SELECT NDEF app, GetVersion -> AM-SEALED acceptance tuple, 7-byte NXP UID
  2 gate         GetTTStatus (0xF7) must be ABSENT (91 1C) -> plain stock, TagTamper rejected
  3 originality  Read_Sig -> NXP ECDSA (secp224r1) originality signature over the UID;
                 its SHA-256 is the chip's physical fingerprint (sent at precheck + enroll)
  4 key state    GetKeyVersion K0..K4: factory (0) -> personalise; ours -> resume
  5 serial       (v2) the chip's serial: read back off the NDEF if an earlier run wrote
                 one, else a fresh random 8 bytes. Must exist on the chip whenever any
                 key is already ours, because v2 keys are derived from it.
  6 registry     backend precheck on (UID, serial, fingerprint): the fingerprint or the
                 serial must not exist; RETIRED is never reused. A shared UID alone is
                 not a refusal at v2 (S-NFC-ID: duplicate-UID chips are real).
  7 pre-write    (v2, factory file only) WriteData the NDEF template, unauthenticated
                 (factory file 02 is Write=E), so the serial is on the chip before
                 any key depends on it
  8 personalise  AuthEV2First(K0 factory) -> ChangeFileSettings (SDM)
                 -> ChangeKey K1, K2, K3, K4 (K1/K4 v2 only) -> ChangeKey K0 (last)
  9 ndef         AuthEV2First(K0 new) -> WriteData NDEF template (Plain file)
 10 read-back    GetFileSettings must match; ISOReadBinary must return our template with
                 a SUN that verifies under the derived keys (decrypt, UID, SDMMAC)
 11 enroll       backend POST /nfc/enroll -> ENROLLED; only now is the chip "encoded"

Changing K0 last means a failure at any point leaves either a factory K0 (re-run
starts over, ChangeKey uses the right old key from GetKeyVersion) or our K0
(re-run resumes at stage 9). No blockchain write anywhere (G5).

Keys: META (fleet), FILE, APP_MASTER, APP_KEY1 and APP_KEY4 (per chip) are
derived via the KeyProvider only after the chip has passed stages 1-6, held as
bytearrays for this one chip and zeroized in `finally`. Nothing here prints or
logs them.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from typing import Callable

from . import __version__ as ENCODER_VERSION
from .audit import AuditLog, operator_identity
from .keyprovider import (
    ROLE_APP_KEY1,
    ROLE_APP_KEY4,
    ROLE_APP_MASTER,
    ROLE_FILE,
    ROLE_META,
    SERIAL_KDF_VERSION,
    KeyProvider,
)
from .ntag424 import apdu as A
from .ntag424 import session as sm
from .ntag424.encode import SERIAL_LEN, SdmTemplate, build_sdm_template, serial_from_ndef, verify_sun
from .registry import Registry, RegistryError, item_uuid_or_none
from .transport import SW_ADDITIONAL_FRAME, SW_ISO_OK, SW_NATIVE_OK, CardIO

FACTORY_KEY = bytes(16)
FACTORY_KEY_VERSION = 0x00
SW_ILLEGAL_COMMAND = 0x911C
SW_AUTH_ERROR = 0x91AE
MAX_WRITE_DATA = 255 - 7  # one short APDU: FileNo + Offset(3) + Length(3) + data

GET_VERSION = [0x90, 0x60, 0x00, 0x00, 0x00]
ADDITIONAL_FRAME = [0x90, 0xAF, 0x00, 0x00, 0x00]
GET_TT_STATUS = [0x90, 0xF7, 0x00, 0x00, 0x00]
READ_SIG = [0x90, 0x3C, 0x00, 0x00, 0x01, 0x00, 0x00]


class EncodeError(RuntimeError):
    """Base: `code` is a closed-set reason, safe for the audit log."""

    def __init__(self, code: str, stage: str, detail: str = "") -> None:
        super().__init__(f"[{stage}] {code}: {detail}" if detail else f"[{stage}] {code}")
        self.code, self.stage, self.detail = code, stage, detail


class Refused(EncodeError):
    """The chip is not eligible. Nothing was written to it."""


class EncodeFailed(EncodeError):
    """Something failed after the chip was accepted. Re-run on the same chip to resume."""


@dataclass(frozen=True)
class EncodeJob:
    item: str
    token: str
    base_url: str
    key_version: int = SERIAL_KDF_VERSION

    @property
    def uses_serial(self) -> bool:
        return self.key_version >= SERIAL_KDF_VERSION


@dataclass(frozen=True)
class EncodeOutcome:
    tag_id: str
    uid_hex: str
    readback_counter: int
    resumed: bool
    readback_url: str  # operator display only; never logged
    serial_hex: str | None = None

    def as_dict(self) -> dict:
        return {
            "tagId": self.tag_id,
            "uid": self.uid_hex,
            "serial": self.serial_hex,
            "readbackCounter": self.readback_counter,
            "resumed": self.resumed,
            "readbackUrl": self.readback_url,
        }


def nxp_originality(uid: bytes, signature: bytes) -> bool:
    """Real originality check (tag-hq genuineness, NIST P-224). Needs `ecdsa`."""
    from tag_hq import genuineness  # lazy: optional dependency

    return genuineness.verify_originality(uid, signature).genuine


def signature_fingerprint(signature: bytes) -> str:
    """SHA-256 of the raw Read_Sig bytes, lowercase hex: one physical chip, one value."""
    return hashlib.sha256(bytes(signature)).hexdigest()


def _zero(*bufs: bytearray) -> None:
    for buf in bufs:
        for i in range(len(buf)):
            buf[i] = 0


class _Chip:
    """APDU helpers bound to one card. Raises EncodeFailed on an unexpected status."""

    def __init__(self, card: CardIO, rng: Callable[[int], bytes]) -> None:
        self.card, self.rng = card, rng
        self.stage = "identify"

    def tx(self, apdu: list[int], *ok: int) -> bytes:
        data, sw = self.card.transmit(apdu)
        if sw not in (ok or (SW_ISO_OK, SW_NATIVE_OK)):
            raise EncodeFailed("unexpected_status", self.stage, f"INS {apdu[1]:02X} -> SW {sw:04X}")
        return data

    def select_app(self) -> None:
        self.tx(A.select_ndef_app(), SW_ISO_OK)

    def authenticate(self, key: bytes, key_no: int = A.KEY_APP_MASTER) -> sm.Session | None:
        """AuthenticateEV2First. Returns None if the card rejects the key (91 AE)."""
        data, sw = self.card.transmit(A.authenticate_ev2_first_cmd1(key_no))
        if sw == SW_AUTH_ERROR:
            return None
        if sw != SW_ADDITIONAL_FRAME or len(data) != 16:
            raise EncodeFailed("unexpected_status", self.stage, f"AuthEV2First part 1 -> SW {sw:04X}")
        rnd_a = self.rng(16)
        part2, rnd_b = sm.auth_part2(key, data, rnd_a)
        data, sw = self.card.transmit(A.authenticate_ev2_first_cmd2(part2))
        if sw == SW_AUTH_ERROR:
            return None
        if sw != SW_NATIVE_OK:
            raise EncodeFailed("unexpected_status", self.stage, f"AuthEV2First part 2 -> SW {sw:04X}")
        try:
            return sm.finish_auth(key, key_no, rnd_a, rnd_b, data)
        except sm.SecureMessagingError as exc:
            raise EncodeFailed("card_auth_failed", self.stage, str(exc)) from exc

    def full(self, s: sm.Session, ins: int, header: bytes, plain: bytes, *, ends_session: bool = False) -> None:
        """Send a CommMode.Full command and verify the response MAC."""
        data = self.tx(s.wrap_full(ins, header, plain), SW_NATIVE_OK)
        if ends_session:
            return
        try:
            s.check_response(0x00, data)
        except sm.SecureMessagingError as exc:
            raise EncodeFailed("response_mac_mismatch", self.stage, f"INS {ins:02X}") from exc


def _read_ndef(chip: _Chip) -> bytes:
    """The NDEF file image as any phone would read it (SDM mirrors, if on, are harmless here)."""
    chip.select_app()
    chip.tx(A.select_ndef_file(), SW_ISO_OK)
    head = chip.tx(A.iso_read_binary(0, 2), SW_ISO_OK)
    nlen = int.from_bytes(head[:2], "big") if len(head) >= 2 else 0
    if nlen == 0 or nlen > MAX_WRITE_DATA:
        return head
    return chip.tx(A.iso_read_binary(0, nlen + 2), SW_ISO_OK)


def _expect_readback(
    chip: _Chip, template: SdmTemplate, uid: bytes, meta: bytes, file_key: bytes, serial: bytes | None
) -> tuple[int, str]:
    """Stage 8. Returns (SDMReadCtr seen, URL as a phone would read it)."""
    from tag_hq import parsers  # read-only, pure; reused per the S-NFC2 spec

    chip.select_app()  # drops authentication: SDM only mirrors on a non-authenticated read
    fs = parsers.parse_file_settings(A.FILE_NDEF, chip.tx([0x90, 0xF5, 0x00, 0x00, 0x01, A.FILE_NDEF, 0x00]))
    sdm = fs.sdm if fs else None
    if not (fs and fs.sdm_enabled and sdm and sdm.picc_encrypted and sdm.mac_enabled):
        raise EncodeFailed("readback_settings_mismatch", chip.stage, "SDM not enabled as written")
    want = (A.SLOT_SDM_META_READ, A.SLOT_SDM_FILE_READ, A.ACCESS_NEVER,
            template.picc_data_offset, template.sdm_mac_input_offset, template.sdm_mac_offset)
    got = (sdm.meta_read, sdm.file_read, sdm.ctr_ret, sdm.picc_data_offset, sdm.mac_input_offset, sdm.mac_offset)
    if got != want:
        raise EncodeFailed("readback_settings_mismatch", chip.stage, f"want {want} got {got}")

    chip.tx(A.select_ndef_file(), SW_ISO_OK)
    image = chip.tx(A.iso_read_binary(0, len(template.ndef_bytes)), SW_ISO_OK)
    if len(image) != len(template.ndef_bytes):
        raise EncodeFailed("readback_ndef_mismatch", chip.stage, "short read")
    p, m = template.picc_data_offset, template.sdm_mac_offset
    masked = bytearray(image)
    masked[p : p + 32] = template.ndef_bytes[p : p + 32]
    masked[m : m + 16] = template.ndef_bytes[m : m + 16]
    if bytes(masked) != template.ndef_bytes:
        raise EncodeFailed("readback_ndef_mismatch", chip.stage, "NDEF differs outside the SDM mirrors")

    picc_hex, mac_hex = image[p : p + 32].decode("ascii"), image[m : m + 16].decode("ascii")
    res = verify_sun(picc_hex, mac_hex, meta, lambda _uid: file_key, -1, uid.hex().upper(), serial)
    if not res.valid:
        raise EncodeFailed("readback_sun_invalid", chip.stage, res.error or "")
    summary = parsers.parse_ndef(image)
    if not (summary and summary.is_sdm_mirror):
        raise EncodeFailed("readback_ndef_mismatch", chip.stage, "NDEF does not parse as a SUN URI")
    return int(res.counter or 0), summary.uri or ""


def personalise(
    card: CardIO,
    keys: KeyProvider,
    registry: Registry,
    job: EncodeJob,
    *,
    audit: AuditLog,
    originality: Callable[[bytes, bytes], bool] = nxp_originality,
    rng: Callable[[int], bytes] = os.urandom,
    mode: str = "pcsc",
) -> EncodeOutcome:
    chip = _Chip(card, rng)
    base_audit = {
        "event": "personalise", "operator": operator_identity(), "item": job.item, "token": job.token,
        "key_version": job.key_version, "mode": mode, "encoder_version": ENCODER_VERSION,
    }
    # Size check up front with a dummy serial: the real one is only known at stage 5.
    try:
        probe = build_sdm_template(job.base_url, job.token, bytes(SERIAL_LEN) if job.uses_serial else None)
    except ValueError as exc:
        raise Refused("url_too_long", "identify", str(exc)) from exc
    if len(probe.ndef_bytes) > MAX_WRITE_DATA:
        raise Refused("url_too_long", "identify", f"NDEF {len(probe.ndef_bytes)} B > {MAX_WRITE_DATA} B")

    slots = (0, 1, 2, 3, 4) if job.uses_serial else (0, 2, 3)
    meta = file_key = master = key1 = key4 = bytearray()
    resumed = False
    serial: bytes | None = None
    try:
        # 1 identify
        from tag_hq import parsers

        chip.select_app()
        p1 = chip.tx(GET_VERSION, SW_ADDITIONAL_FRAME)
        p2 = chip.tx(ADDITIONAL_FRAME, SW_ADDITIONAL_FRAME)
        p3 = chip.tx(ADDITIONAL_FRAME, SW_NATIVE_OK)
        version = parsers.parse_get_version(p1, p2, p3)
        uid = bytes(version.uid)
        if not version.matches_reference:
            raise Refused("not_reference_chip", "identify", version.variant)
        if len(uid) != 7 or uid[0] != 0x04:
            raise Refused("bad_uid", "identify")
        uid_hex = uid.hex().upper()

        # 2 gate: GetTTStatus exists only on TagTamper silicon
        chip.stage = "gate"
        _, sw = card.transmit(GET_TT_STATUS)
        if sw != SW_ILLEGAL_COMMAND:
            raise Refused("tagtamper_or_unknown", "gate", f"GetTTStatus SW {sw:04X}")

        # 3 originality (Read_Sig answers 91 90 on real silicon: gate on the crypto, not the SW)
        chip.stage = "originality"
        sig, _ = card.transmit(READ_SIG)
        if not originality(uid, sig):
            raise Refused("originality_failed", "originality")
        sig_sha256 = signature_fingerprint(sig)

        # 4 key state
        chip.stage = "key_state"
        kv = {k: chip.tx(A.get_key_version(k), SW_NATIVE_OK)[0] for k in slots}
        if kv[0] == job.key_version:
            resumed = True
        elif kv[0] != FACTORY_KEY_VERSION:
            raise Refused("foreign_keys", "key_state", f"K0 version {kv[0]:#04x}")
        for slot in slots[1:]:
            if kv[slot] not in (FACTORY_KEY_VERSION, job.key_version):
                raise Refused("foreign_keys", "key_state", f"K{slot} version {kv[slot]:#04x}")
        any_ours = any(kv[k] == job.key_version for k in slots)

        # 5 serial (v2): keys depend on it, so a chip with any of our keys must carry it
        on_chip: bytes | None = None
        if job.uses_serial:
            chip.stage = "serial"
            on_chip = serial_from_ndef(_read_ndef(chip))
            if on_chip is None and any_ours:
                raise EncodeFailed("serial_missing", "serial", "keys already set but no serial on the chip")
            serial = on_chip if on_chip is not None else rng(SERIAL_LEN)
        serial_hex = serial.hex().upper() if serial is not None else None
        template = build_sdm_template(job.base_url, job.token, serial)

        # 6 registry (fail closed: any error stops the encode)
        chip.stage = "registry"
        try:
            pre = registry.precheck(uid_hex, serial_hex, sig_sha256)
        except RegistryError as exc:
            raise Refused("registry_unavailable", "registry", str(exc)) from exc
        if pre.lifecycle_status == "RETIRED":
            raise Refused("retired_uid", "registry", "retired chips are never reused")
        if pre.exists:
            raise Refused("already_registered", "registry", f"lifecycle {pre.lifecycle_status}")

        # 7 pre-write (v2): the serial lands on the chip before any key depends on it
        if job.uses_serial and on_chip is None:
            chip.stage = "prewrite"
            chip.select_app()
            chip.tx(A.write_data_plain(A.FILE_NDEF, 0, template.ndef_bytes), SW_NATIVE_OK)
            if serial_from_ndef(_read_ndef(chip)) != serial:
                raise EncodeFailed("serial_write_failed", "prewrite", "serial did not read back")

        meta = bytearray(keys.derive_key(ROLE_META, job.key_version))
        file_key = bytearray(keys.derive_key(ROLE_FILE, job.key_version, uid, serial))
        master = bytearray(keys.derive_key(ROLE_APP_MASTER, job.key_version, uid, serial))
        if job.uses_serial:
            key1 = bytearray(keys.derive_key(ROLE_APP_KEY1, job.key_version, uid, serial))
            key4 = bytearray(keys.derive_key(ROLE_APP_KEY4, job.key_version, uid, serial))

        # 8 personalise (skipped on resume: K0 is changed last, so ours means 8 completed)
        if not resumed:
            chip.stage = "personalise"
            s = chip.authenticate(FACTORY_KEY)
            if s is None:
                raise Refused("factory_key_rejected", "personalise", "K0 version 0 but not the factory key")
            try:
                chip.full(s, A.INS_CHANGE_FILE_SETTINGS, bytes([A.FILE_NDEF]), A.sdm_file_settings_payload(
                    picc_data_offset=template.picc_data_offset,
                    sdm_mac_input_offset=template.sdm_mac_input_offset,
                    sdm_mac_offset=template.sdm_mac_offset,
                ))
                changes = [(A.SLOT_SDM_META_READ, meta), (A.SLOT_SDM_FILE_READ, file_key)]
                if job.uses_serial:
                    changes = [(A.KEY_APP_1, key1), *changes, (A.KEY_APP_4, key4)]
                for slot, new in changes:
                    if kv[slot] == job.key_version:
                        continue  # an earlier run already set it
                    plain = sm.change_key_plaintext(slot, A.KEY_APP_MASTER, bytes(new), FACTORY_KEY, job.key_version)
                    chip.full(s, A.INS_CHANGE_KEY, bytes([slot]), plain)
                plain = sm.change_key_plaintext(A.KEY_APP_MASTER, A.KEY_APP_MASTER, bytes(master), None, job.key_version)
                chip.full(s, A.INS_CHANGE_KEY, bytes([A.KEY_APP_MASTER]), plain, ends_session=True)
            finally:
                s.zeroize()

        # 9 NDEF template, under the NEW K0 (this also proves K0 took)
        chip.stage = "ndef"
        s = chip.authenticate(bytes(master))
        if s is None:
            raise EncodeFailed("new_master_key_rejected", "ndef", "K0 is not the derived APP_MASTER")
        try:
            chip.tx(A.write_data_plain(A.FILE_NDEF, 0, template.ndef_bytes), SW_NATIVE_OK)
        finally:
            s.zeroize()

        # 10 read-back
        chip.stage = "readback"
        counter, url = _expect_readback(chip, template, uid, bytes(meta), bytes(file_key), serial)

        # 11 enroll: only now does the chip count as encoded
        chip.stage = "enroll"
        try:
            tag_id = registry.enroll(uid_hex, item_uuid_or_none(job.item), serial_hex, sig_sha256, job.key_version)
        except RegistryError as exc:
            raise EncodeFailed("enroll_failed", "enroll", str(exc)) from exc
    except EncodeError as exc:
        result = "refused" if isinstance(exc, Refused) else "failed"
        audit.write(**base_audit, result=result, reason=exc.code, stage=exc.stage, resumed=resumed)
        raise
    except Exception as exc:
        audit.write(**base_audit, result="failed", reason="internal_error", stage=chip.stage, resumed=resumed)
        raise EncodeFailed("internal_error", chip.stage, type(exc).__name__) from exc
    finally:
        _zero(meta, file_key, master, key1, key4)

    # The serial is an identifier like the UID, so it stays out of the ledger (tag_id links it).
    audit.write(**base_audit, result="encoded", tag_id=tag_id, readback_counter=counter, resumed=resumed)
    return EncodeOutcome(tag_id, uid_hex, counter, resumed, url, serial_hex)
