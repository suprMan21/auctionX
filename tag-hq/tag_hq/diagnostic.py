"""Full read-only diagnostic flow: orchestrates transport + apdu + parsers +
genuineness + verdict into one snapshot dict.

Covers the directive's "Full Diagnostic Coverage":
  activation/RF · identity (GetVersion/Gx) · genuineness (Read_Sig + verify) ·
  file structure (CC/NDEF) · key config (5 key versions + ship-state) ·
  SDM/SUN capability+config · crypto mode · per-tag FIT/NOT-FIT verdict.

Every chip command flows through Transport's read-only whitelist. Key VERSION
bytes are read; key material never is.
"""

from __future__ import annotations

import logging

from . import apdu, genuineness, parsers, verdict
from .transport import ApduResponse, Transport

log = logging.getLogger("tag_hq.diagnostic")


def _safe(fn, label, errors: list[str]):
    """Run a read step; on failure append to errors and return None (best-effort scan)."""
    try:
        return fn()
    except Exception as exc:  # pragma: no cover - hardware-path resilience
        errors.append(f"{label}: {exc}")
        return None


def _get_version(tx: Transport) -> parsers.VersionInfo | None:
    r1 = tx.transmit(apdu.GET_VERSION_1)
    r2 = tx.transmit(apdu.GET_VERSION_NEXT)
    r3 = tx.transmit(apdu.GET_VERSION_NEXT)
    return parsers.parse_get_version(r1.data, r2.data, r3.data)


def _read_signature(tx: Transport) -> tuple[bytes, str]:
    """Return (56-byte signature, SW hex). The ECDSA verify is the real gate.

    Read_Sig (90 3C 00 00 01 00 00) returns the 56-byte originality signature as
    the data field. Genuine NXP silicon observed on first hardware tap (2026-06-18)
    returns trailing SW 91 90, NOT the 91 00 the AN12196 worked example implies;
    other chips return 90 00. So we accept the payload whenever it is exactly 56
    bytes regardless of the trailing SW and record the SW for diagnostics — a wrong
    UID/key still fails the cryptographic verify downstream. Length/param errors
    (917E, 910C, etc.) return 0 bytes and correctly raise here.
    """
    tx.transmit(apdu.SELECT_NDEF_APP)
    resp: ApduResponse = tx.transmit(apdu.READ_SIG)
    if len(resp.data) != genuineness.SIGNATURE_LEN:
        raise RuntimeError(
            f"Read_Sig returned {len(resp.data)} bytes (SW {resp.sw_hex}), expected 56"
        )
    return resp.data, resp.sw_hex


def _read_cc(tx: Transport) -> parsers.CapabilityContainer | None:
    tx.transmit(apdu.SELECT_NDEF_APP)
    tx.transmit(apdu.SELECT_CC_FILE)
    resp = tx.transmit(apdu.iso_read_binary(0, 0x0F))
    return parsers.parse_cc(resp.data)


def _read_ndef(tx: Transport) -> parsers.NdefSummary | None:
    tx.transmit(apdu.SELECT_NDEF_APP)
    tx.transmit(apdu.SELECT_NDEF_FILE)
    resp = tx.transmit(apdu.iso_read_binary(0, 0x00))
    return parsers.parse_ndef(resp.data)


def _read_file_settings(tx: Transport) -> dict[int, parsers.FileSettings]:
    tx.transmit(apdu.SELECT_NDEF_APP)
    out: dict[int, parsers.FileSettings] = {}
    for fno in (apdu.FILE_CC, apdu.FILE_NDEF, apdu.FILE_PROPRIETARY):
        resp = tx.transmit(apdu.get_file_settings(fno))
        if resp.ok:
            fs = parsers.parse_file_settings(fno, resp.data)
            if fs:
                out[fno] = fs
    return out


def _read_key_versions(tx: Transport) -> dict[int, int]:
    tx.transmit(apdu.SELECT_NDEF_APP)
    versions: dict[int, int] = {}
    for kno in apdu.KEY_NUMBERS:
        resp = tx.transmit(apdu.get_key_version(kno))
        if resp.ok and resp.data:
            versions[kno] = resp.data[0]  # VERSION byte only — never key material
    return versions


def _reader_uid(tx: Transport) -> bytes:
    resp = tx.transmit(apdu.GET_DATA_UID)
    return resp.data if resp.ok else b""


def run_full_diagnostic(tx: Transport) -> dict:
    """Run the complete read-only diagnostic and return a JSON-able snapshot."""
    errors: list[str] = []

    reader_uid = _safe(lambda: _reader_uid(tx), "reader-uid", errors) or b""
    activation = parsers.parse_activation(tx.atr, reader_uid)
    version = _safe(lambda: _get_version(tx), "get-version", errors)
    sig_result = _safe(lambda: _read_signature(tx), "read-sig", errors)
    signature, sig_sw = (sig_result if sig_result else (None, None))
    cc = _safe(lambda: _read_cc(tx), "cc", errors)
    ndef = _safe(lambda: _read_ndef(tx), "ndef", errors)
    file_settings = _safe(lambda: _read_file_settings(tx), "file-settings", errors) or {}
    key_versions = _safe(lambda: _read_key_versions(tx), "key-versions", errors) or {}

    # --- genuineness (§3) ---
    uid_for_verify = version.uid if version else b""
    if activation.random_id:
        gen = genuineness.OriginalityResult(
            False, activation.uid_from_reader,
            "random-ID active; true UID unavailable to read-only station",
        )
    elif signature and len(uid_for_verify) == genuineness.UID_LEN:
        gen = genuineness.verify_originality(uid_for_verify, signature)
    else:
        gen = genuineness.OriginalityResult(
            False, (uid_for_verify.hex().upper() if uid_for_verify else "UNKNOWN"),
            "signature or UID unavailable",
        )

    key_config = parsers.parse_key_versions(key_versions)
    sdm_enabled = any(fs.sdm_enabled for fs in file_settings.values())

    # --- verdict ---
    v = verdict.evaluate(
        genuine=gen.genuine,
        genuine_reason=gen.reason,
        matches_reference=bool(version and version.matches_reference),
        variant=version.variant if version else "unknown",
        random_id=activation.random_id,
        possible_tt=bool(version and version.possible_tt),
        version_notes=(version.notes if version else []) + activation.notes,
    )

    # Log key VERSIONS only (never bytes) — satisfies the audit/no-key-material rule.
    log.info("scan uid=%s key_versions=%s verdict=%s",
             gen.uid_hex, key_versions, v.badge)

    return {
        "uid_hex": gen.uid_hex,
        "genuine": gen.genuine,
        "genuine_label": gen.label,
        "genuine_reason": gen.reason,
        "variant": version.variant if version else "unknown",
        "reader_name": tx.reader_name,
        "activation": {
            "atr_hex": activation.atr_hex,
            "historical_hex": activation.historical_hex,
            "uid_from_reader": activation.uid_from_reader,
            "random_id": activation.random_id,
            "notes": activation.notes,
        },
        "identity": None if not version else {
            "vendor_id": f"0x{version.vendor_id:02X}",
            "is_nxp": version.is_nxp,
            "matches_reference": version.matches_reference,
            "possible_tt": version.possible_tt,
            "variant": version.variant,
            "hw": f"type=0x{version.hw_type:02X} sub=0x{version.hw_subtype:02X} "
                  f"v{version.hw_major}.{version.hw_minor} storage=0x{version.storage_size:02X} "
                  f"proto=0x{version.protocol:02X}",
            "sw_subtype": f"0x{version.sw_subtype:02X}",
            "uid_hex": version.uid_hex,
            "prefix14": version.prefix14.hex().upper(),
            "reference_tuple": (
                f"type=0x{parsers.REF_HW_TYPE:02X} storage=0x{parsers.REF_STORAGE:02X} "
                f"sw_subtype=0x{parsers.REF_SW_SUBTYPE:02X} proto=0x{parsers.REF_PROTOCOL:02X}"
            ),
            "notes": version.notes,
        },
        "signature_hex": signature.hex().upper() if signature else None,
        "signature_sw": sig_sw,
        "file_structure": {
            "cc": None if not cc else {
                "mapping_version": cc.mapping_version,
                "ndef_file_id": f"0x{cc.ndef_file_id:04X}",
                "ndef_max_size": cc.ndef_max_size,
                "read_access": f"0x{cc.read_access:02X}",
                "write_access": f"0x{cc.write_access:02X}",
                "read_only": cc.read_only,
            },
            "ndef": None if not ndef else {
                "nlen": ndef.nlen, "uri": ndef.uri,
                "is_sdm_mirror": ndef.is_sdm_mirror, "notes": ndef.notes,
            },
        },
        "key_config": {
            "ship_state": key_config.ship_state,
            "all_default": key_config.all_default,
            "versions": {f"key_{k.key_no}": k.version for k in key_config.keys},
        },
        "sdm_sun": {
            "enabled": sdm_enabled,
            "ndef_mirror_detected": bool(ndef and ndef.is_sdm_mirror),
            "files": {f"file_{fno}": {"comm_mode": fs.comm_mode, "sdm": fs.sdm_enabled}
                      for fno, fs in file_settings.items()},
        },
        "crypto_mode": parsers.detect_crypto_mode(version) if version else "unknown",
        "verdict": {
            "fit": v.fit, "badge": v.badge, "headline": v.headline,
            "reasons": v.reasons, "flags": v.flags,
        },
        "errors": errors,
    }
