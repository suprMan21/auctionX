"""survey.py row building (S-NFC-ID): pure, no reader."""

import hashlib

from survey import key_state, row_from_snapshot

SIG = "AB" * 56


def _snap(uri=None, versions=None):
    return {
        "uid_hex": "04A27E02936980",
        "genuine": True,
        "signature_hex": SIG,
        "variant": "NTAG 424 DNA",
        "key_config": {"versions": versions or {f"key_{k}": 0 for k in range(5)}},
        "file_structure": {"ndef": {"uri": uri} if uri else None},
        "sdm_sun": {"enabled": uri is not None},
        "errors": [],
    }


def test_fingerprint_matches_the_encoder_definition():
    row = row_from_snapshot(_snap(), "A1")
    assert row["fingerprint"] == hashlib.sha256(bytes.fromhex(SIG)).hexdigest()
    assert row["key_state"] == "factory" and row["serial"] == "" and row["token"] == ""


def test_v2_chip_reports_serial_and_token():
    uri = "https://x.example/verify/chip_002?sn=85B5BF9D81903928&picc_data=00&cmac=00"
    row = row_from_snapshot(_snap(uri, {f"key_{k}": 2 for k in range(5)}), "chip_002")
    assert (row["serial"], row["token"], row["key_state"], row["sdm_enabled"]) == (
        "85B5BF9D81903928", "chip_002", "v2", True)
    assert row["key_versions"] == "K0=2 K1=2 K2=2 K3=2 K4=2"


def test_key_state_buckets():
    assert key_state({"key_0": 1, "key_1": 0, "key_2": 1, "key_3": 1, "key_4": 0}) == "mixed"
    assert key_state({}) == "unknown"
