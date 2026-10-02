#!/usr/bin/env python3
"""Generate test-vectors/ntag424_sdm_vectors.json with OpenSSL as the oracle.

S-NFC3.5. This script is deliberately INDEPENDENT of the code under test:

  * every AES-128-CBC encrypt/decrypt, AES-CMAC, HMAC-SHA256 and HKDF-Expand
    below is computed by the `openssl` binary (subprocess), never by
    tag_encoder/, backend/ or tag_hq/;
  * the only Python here is byte concatenation, slicing and JSON formatting.

So when backend vitest, tag-encoder pytest and tag-hq pytest all reproduce
these bytes, they are agreeing with OpenSSL, not with each other.

Golden vector #1 is NXP AN12196's own SDM example (all-zero keys). Its expected
intermediates are hard-coded below as literals and asserted against OpenSSL's
output, so this script fails loudly if the oracle and the published example
ever disagree.

Run (from the app root, needs OpenSSL >= 3.0 for `openssl mac` / `openssl kdf`):
    python3 test-vectors/generate_ntag424_vectors.py
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

OUT = Path(__file__).with_name("ntag424_sdm_vectors.json")

# --- OpenSSL oracle ----------------------------------------------------------


def _run(args: list[str], data: bytes = b"") -> bytes:
    proc = subprocess.run(["openssl", *args], input=data, capture_output=True, check=True)
    return proc.stdout


def _hex_out(raw: bytes) -> str:
    """`openssl mac`/`openssl kdf` print hex (kdf with ':' separators)."""
    return raw.decode().strip().replace(":", "").upper()


def aes_cbc_encrypt(key: bytes, plaintext: bytes) -> bytes:
    iv = "00" * 16
    return _run(["enc", "-aes-128-cbc", "-K", key.hex(), "-iv", iv, "-nopad"], plaintext)


def aes_cbc_decrypt(key: bytes, ciphertext: bytes) -> bytes:
    iv = "00" * 16
    return _run(["enc", "-d", "-aes-128-cbc", "-K", key.hex(), "-iv", iv, "-nopad"], ciphertext)


def aes_cmac(key: bytes, message: bytes) -> bytes:
    out = _run(["mac", "-cipher", "AES-128-CBC", "-macopt", f"hexkey:{key.hex()}", "CMAC"], message)
    return bytes.fromhex(_hex_out(out))


def hmac_sha256(key: bytes, message: bytes) -> bytes:
    out = _run(["mac", "-digest", "SHA256", "-macopt", f"hexkey:{key.hex()}", "HMAC"], message)
    return bytes.fromhex(_hex_out(out))


def hkdf_expand(prk: bytes, info: bytes, length: int) -> bytes:
    out = _run([
        "kdf", "-keylen", str(length),
        "-kdfopt", "digest:SHA256",
        "-kdfopt", "mode:EXPAND_ONLY",
        "-kdfopt", f"hexkey:{prk.hex()}",
        "-kdfopt", f"hexinfo:{info.hex()}",
        "HKDF",
    ])
    return bytes.fromhex(_hex_out(out))


def openssl_version() -> str:
    return _run(["version"]).decode().strip()


# --- Spec constants (AN12196 + Decisions DB 2026-10-01) ----------------------

SV2_PREFIX = bytes.fromhex("3CC300010080")  # SesSDMFileReadMAC derivation vector header
KDF_LABEL = b"AM-NTAG424-KDF"


def h(b: bytes) -> str:
    return b.hex().upper()


def truncate_even(full_cmac: bytes) -> bytes:
    """AN12196: keep the even-numbered bytes (1-based) = indices 1,3,..,15."""
    return bytes(full_cmac[i] for i in range(1, 16, 2))


def kdf_message(role: str, version: int, uid: bytes) -> bytes:
    return KDF_LABEL + b"\x00" + role.encode("ascii") + b"\x00" + bytes([version]) + uid


def kdf_info(role: str, version: int) -> bytes:
    return f"NTAG424-DNA/{role}/AES128/v{version}".encode("ascii")


def kdf_vector(name: str, root: bytes, role: str, version: int, uid: bytes) -> dict:
    msg = kdf_message(role, version, uid)
    prk = hmac_sha256(root, msg)
    info = kdf_info(role, version)
    key = hkdf_expand(prk, info, 16)
    return {
        "name": name,
        "rootKey": h(root),
        "role": role,
        "version": version,
        "uid": h(uid),
        "message": h(msg),
        "prk": h(prk),
        "info": h(info),
        "key": h(key),
    }


def sdm_vector(
    name: str,
    meta_key: bytes,
    file_key: bytes,
    uid: bytes,
    counter: int,
    padding: bytes,
    mac_input: bytes = b"",
    enc_picc_override: bytes | None = None,
) -> dict:
    ctr_le = counter.to_bytes(3, "little")
    plaintext = bytes([0xC7]) + uid + ctr_le + padding
    assert len(plaintext) == 16
    enc = aes_cbc_encrypt(meta_key, plaintext)
    if enc_picc_override is not None:
        # Golden path: ciphertext comes from the published example; prove the
        # oracle decrypts it to the published plaintext.
        assert aes_cbc_decrypt(meta_key, enc_picc_override) == plaintext, name
        enc = enc_picc_override
    assert aes_cbc_decrypt(meta_key, enc) == plaintext
    sv2 = SV2_PREFIX + uid + ctr_le
    ses = aes_cmac(file_key, sv2)
    full = aes_cmac(ses, mac_input)
    trunc = truncate_even(full)
    return {
        "name": name,
        "sdmMetaReadKey": h(meta_key),
        "sdmFileReadKey": h(file_key),
        "uid": h(uid),
        "counter": counter,
        "counterLE": h(ctr_le),
        "piccDataTag": "C7",
        "piccPadding": h(padding),
        "piccPlaintext": h(plaintext),
        "encPiccData": h(enc),
        "sv2": h(sv2),
        "sessionMacKey": h(ses),
        "macInput": h(mac_input),
        "fullCmac": h(full),
        "truncatedCmac": h(trunc),
    }


def main() -> int:
    zero = bytes(16)

    # Golden vector #1 — AN12196 SDM example, all-zero keys.
    golden = sdm_vector(
        "an12196_golden_zero_keys",
        zero,
        zero,
        bytes.fromhex("04DE5F1EACC040"),
        61,
        bytes.fromhex("DA5CF60941"),
        enc_picc_override=bytes.fromhex("EF963FF7828658A599F3041510671E88"),
    )
    expected = {
        "piccPlaintext": "C704DE5F1EACC0403D0000DA5CF60941",
        "counterLE": "3D0000",
        "sessionMacKey": "3FB5F6E3A807A03D5E3570ACE393776F",
        "fullCmac": "E194C7EE12D9F7EE8A65C8331B704386",
        "truncatedCmac": "94EED9EE65337086",
    }
    for k, v in expected.items():
        if golden[k] != v:
            print(f"FATAL: OpenSSL disagrees with AN12196 on {k}: {golden[k]} != {v}", file=sys.stderr)
            return 1

    sdm = [
        golden,
        sdm_vector(
            "nonzero_keys_ctr1",
            bytes.fromhex("8F3B1C2D4E5F60718293A4B5C6D7E8F9"),
            bytes.fromhex("0F1E2D3C4B5A69788796A5B4C3D2E1F0"),
            bytes.fromhex("04A27E02936980"),
            1,
            bytes.fromhex("1122334455"),
        ),
        sdm_vector(
            "nonzero_keys_large_counter_le",
            bytes.fromhex("00112233445566778899AABBCCDDEEFF"),
            bytes.fromhex("FFEEDDCCBBAA99887766554433221100"),
            bytes.fromhex("0456789ABCDEF0"),
            0xABCDEF,
            bytes.fromhex("A0B1C2D3E4"),
        ),
        sdm_vector(
            "counter_zero",
            bytes.fromhex("2B7E151628AED2A6ABF7158809CF4F3C"),
            bytes.fromhex("603DEB1015CA71BE2B73AEF0857D7781"),
            bytes.fromhex("04112233445566"),
            0,
            bytes.fromhex("0000000000"),
        ),
        sdm_vector(
            "nonempty_mac_input_range",
            bytes.fromhex("8F3B1C2D4E5F60718293A4B5C6D7E8F9"),
            bytes.fromhex("0F1E2D3C4B5A69788796A5B4C3D2E1F0"),
            bytes.fromhex("04A27E02936980"),
            7,
            bytes.fromhex("5566778899"),
            mac_input=b"AM-SDM-MAC-INPUT-RANGE&x=",
        ),
    ]

    roots = [
        ("root_a", bytes.fromhex("000102030405060708090A0B0C0D0E0F101112131415161718191A1B1C1D1E1F")),
        ("root_b", bytes.fromhex("F0E1D2C3B4A5968778695A4B3C2D1E0FFFEEDDCCBBAA99887766554433221100")),
    ]
    uid_a = bytes.fromhex("04A27E02936980")
    uid_b = bytes.fromhex("04DE5F1EACC040")
    kdf: list[dict] = []
    for rname, root in roots:
        for version in (1, 2):
            kdf.append(kdf_vector(f"{rname}_META_v{version}", root, "META", version, b""))
            for uname, uid in (("uidA", uid_a), ("uidB", uid_b)):
                kdf.append(kdf_vector(f"{rname}_FILE_v{version}_{uname}", root, "FILE", version, uid))
            kdf.append(kdf_vector(f"{rname}_APP_MASTER_v{version}_uidA", root, "APP_MASTER", version, uid_a))

    # End-to-end: KDF-derived keys feeding real SDM (provider -> codec chain).
    root = roots[0][1]
    meta = bytes.fromhex(next(v for v in kdf if v["name"] == "root_a_META_v1")["key"])
    file_a = bytes.fromhex(next(v for v in kdf if v["name"] == "root_a_FILE_v1_uidA")["key"])
    file_b = bytes.fromhex(next(v for v in kdf if v["name"] == "root_a_FILE_v1_uidB")["key"])
    chain = [
        {"rootKey": h(root), "version": 1, **sdm_vector(
            "kdf_chain_root_a_v1_uidA_ctr5", meta, file_a, uid_a, 5, bytes.fromhex("0102030405"))},
        {"rootKey": h(root), "version": 1, **sdm_vector(
            "kdf_chain_root_a_v1_uidB_ctr5", meta, file_b, uid_b, 5, bytes.fromhex("0102030405"))},
    ]

    picc_data_tags = [
        {"byte": "C7", "uidMirrored": True, "ctrMirrored": True, "uidLength": 7, "accept": True},
        {"byte": "87", "uidMirrored": True, "ctrMirrored": False, "uidLength": 7, "accept": False},
        {"byte": "47", "uidMirrored": False, "ctrMirrored": True, "uidLength": 7, "accept": False},
        {"byte": "C4", "uidMirrored": True, "ctrMirrored": True, "uidLength": 4, "accept": False},
        {"byte": "CA", "uidMirrored": True, "ctrMirrored": True, "uidLength": 10, "accept": False},
        {"byte": "C0", "uidMirrored": True, "ctrMirrored": True, "uidLength": 0, "accept": False},
        {"byte": "00", "uidMirrored": False, "ctrMirrored": False, "uidLength": 0, "accept": False},
        # bits 5..4 are RFU; a set RFU bit does not change what is mirrored.
        {"byte": "F7", "uidMirrored": True, "ctrMirrored": True, "uidLength": 7, "accept": True},
    ]

    doc = {
        "_source": (
            "Generated by test-vectors/generate_ntag424_vectors.py with OpenSSL as the oracle "
            "(AES-128-CBC, AES-CMAC, HMAC-SHA256, HKDF-Expand all computed by the openssl binary). "
            "Shared by backend vitest, tag-encoder pytest and tag-hq pytest. Do not hand-edit; "
            "re-run the script."
        ),
        "_generator": "test-vectors/generate_ntag424_vectors.py",
        "_openssl": openssl_version(),
        "_spec": {
            "piccData": "AES-128-CBC-decrypt(SDMMetaReadKey, IV=0, ENCPICCData); PICCDataTag(1) || UID(7) || SDMReadCtr(3, LE) || padding(5)",
            "sv2": "3CC300010080 || UID(7) || SDMReadCtr(3, LE)",
            "sessionMacKey": "AES-CMAC(SDMFileReadKey, SV2)",
            "mac": "AES-CMAC(sessionMacKey, bytes[SDMMACInputOffset:SDMMACOffset])",
            "truncation": "even-numbered bytes (indices 1,3,...,15) of the 16-byte CMAC",
            "kdfMessage": "'AM-NTAG424-KDF' || 00 || role_ascii || 00 || version(1) || uid(0 or 7)",
            "kdfPrk": "HMAC-SHA256(root, message)",
            "kdfKey": "HKDF-Expand(prk, info='NTAG424-DNA/'||role||'/AES128/v'||version_decimal, L=16)",
        },
        "sdm": sdm,
        "kdf": kdf,
        "kdfChain": chain,
        "piccDataTag": picc_data_tags,
    }
    OUT.write_text(json.dumps(doc, indent=2) + "\n")
    print(f"wrote {OUT} ({len(sdm)} sdm, {len(kdf)} kdf, {len(chain)} chain, {len(picc_data_tags)} tag vectors)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
