"""SIM-PARITY tests: encode_sun() must byte-match the backend simulator.

Golden vectors in golden_vectors.json were produced by running the exact logic
of backend/src/services/nfc/ntag424Simulator.ts (encryptPiccData + computeCmac
truncated to 8B + buildSunUrl) under node 22. If any of these fail, the encoder
has DIVERGED from the simulator — do not "fix" the fixtures; fix the encoder (or,
if the simulator changed, regenerate the fixtures and note it in SIM_PARITY.md).
"""

import json
from pathlib import Path

import pytest

from tag_encoder.ntag424.encode import (
    decrypt_picc_data,
    encode_sun,
    encrypt_picc_data,
    truncated_cmac_hex,
)

_VECTORS = json.loads((Path(__file__).parent / "golden_vectors.json").read_text())["vectors"]


@pytest.mark.parametrize("v", _VECTORS, ids=[f"{v['uid']}:{v['counter']}" for v in _VECTORS])
def test_encode_matches_simulator(v):
    result = encode_sun(v["uid"], v["counter"], v["key"], v["baseUrl"], v["tokenName"])
    assert result.enc_picc_hex == v["encPiccHex"], "PICC ciphertext diverged from simulator"
    assert result.cmac_hex == v["cmacHex"], "truncated CMAC diverged from simulator"
    assert result.sun_url == v["sunUrl"], "SUN URL diverged from simulator"


@pytest.mark.parametrize("v", _VECTORS, ids=[f"{v['uid']}:{v['counter']}" for v in _VECTORS])
def test_encrypt_and_cmac_helpers_match(v):
    assert encrypt_picc_data(v["uid"], v["counter"], v["key"]) == v["encPiccHex"]
    assert truncated_cmac_hex(v["encPiccHex"], v["key"]) == v["cmacHex"]


@pytest.mark.parametrize("v", _VECTORS, ids=[f"{v['uid']}:{v['counter']}" for v in _VECTORS])
def test_decrypt_recovers_uid_and_counter(v):
    """Mirror of backend decryptPiccData: enc -> (uid, counter) round-trips."""
    recovered = decrypt_picc_data(v["encPiccHex"], v["key"])
    assert recovered is not None
    uid, counter = recovered
    assert uid == v["uid"].upper()
    assert counter == v["counter"]


def test_decrypt_rejects_wrong_header():
    # Encrypt then decrypt with the WRONG key -> header byte won't be 0xC7.
    enc = encrypt_picc_data("04A27E02936980", 5, "00112233445566778899AABBCCDDEEFF")
    assert decrypt_picc_data(enc, "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF") is None
