"""CLI smoke tests: encode (json + dry-run), read round-trip, verify pass/fail."""

import json

from tag_encoder.cli import main
from tag_encoder.keyprovider import LocalStubKeyProvider
from tag_encoder.ntag424.encode import encode_sun


def test_encode_json_output(capsys):
    rc = main(["encode", "--item", "abc", "--counter", "3"])
    assert rc == 0
    out = json.loads(capsys.readouterr().out)
    assert out["item"] == "abc"
    assert out["counter"] == 3
    assert len(out["uid"]) == 14 and out["uid"].startswith("04")
    assert out["sunUrl"].startswith("https://authentic-materials.com/verify/abc?")


def test_encode_dry_run_prints_apdu_sequence(capsys):
    rc = main(["encode", "--item", "abc", "--dry-run"])
    assert rc == 0
    text = capsys.readouterr().out
    assert "DRY RUN" in text
    assert "AuthenticateEV2First" in text
    assert "REQUIRES LIVE CHANNEL" in text
    assert "SUN URL:" in text


def test_encode_explicit_uid_and_verify_roundtrip(capsys):
    uid = "04A27E02936980"
    rc = main(["encode", "--item", "x", "--uid", uid, "--counter", "7"])
    assert rc == 0
    out = json.loads(capsys.readouterr().out)
    # Verify the produced PICC+CMAC with the same key passes the verify command.
    rc2 = main([
        "verify", "--uid", uid, "--key", out["keyHex"],
        "--picc", out["encPiccHex"], "--cmac", out["cmacHex"], "--last-counter", "6",
    ])
    assert rc2 == 0
    res = json.loads(capsys.readouterr().out)
    assert res["valid"] is True
    assert res["counterValue"] == 7


def test_verify_rejects_replay(capsys):
    uid = "04A27E02936980"
    key = LocalStubKeyProvider().derive_tag_key(bytes.fromhex(uid))
    enc = encode_sun(uid, 5, key, "https://t.co", "x")
    rc = main([
        "verify", "--uid", uid, "--key", key.hex().upper(),
        "--picc", enc.enc_picc_hex, "--cmac", enc.cmac_hex, "--last-counter", "5",
    ])
    assert rc == 1
    assert json.loads(capsys.readouterr().out)["error"] == "Counter replay detected"


def test_verify_rejects_bad_cmac(capsys):
    uid = "04A27E02936980"
    key = LocalStubKeyProvider().derive_tag_key(bytes.fromhex(uid))
    enc = encode_sun(uid, 5, key, "https://t.co", "x")
    rc = main([
        "verify", "--uid", uid, "--key", key.hex().upper(),
        "--picc", enc.enc_picc_hex, "--cmac", "0000000000000000", "--last-counter", "4",
    ])
    assert rc == 1
    assert json.loads(capsys.readouterr().out)["error"] == "CMAC verification failed"


def test_read_roundtrips_encoded_ndef(capsys):
    enc = encode_sun("04A27E02936980", 1, "00112233445566778899AABBCCDDEEFF",
                     "https://authentic-materials.com", "item_123")
    rc = main(["read", "--ndef", enc.ndef_bytes.hex().upper()])
    assert rc == 0
    out = json.loads(capsys.readouterr().out)
    assert out["uri"] == enc.sun_url
