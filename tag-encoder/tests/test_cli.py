"""CLI tests (S-NFC3.5): encode / dry-run / read / verify, and NO key material on stdout/stderr."""

import json

import pytest

from tag_encoder import cli
from tag_encoder.cli import main
from tag_encoder.keyprovider import LocalKeyProvider

UID = "04A27E02936980"


def _all_dev_secrets(uid_hex: str, versions=(1,)) -> list[str]:
    """Every root and derived key the CLI could touch for this UID, as lowercase hex."""
    p = LocalKeyProvider(cli._DEV_SDM_ROOT, cli._DEV_ADMIN_ROOT, allow_local_keys=True)
    uid = bytes.fromhex(uid_hex)
    out = [cli._DEV_SDM_ROOT.hex(), cli._DEV_ADMIN_ROOT.hex()]
    for v in versions:
        out += [
            p.derive_key("META", v).hex(),
            p.derive_key("FILE", v, uid).hex(),
            p.derive_key("APP_MASTER", v, uid).hex(),
        ]
    return out


def _assert_no_secrets(text: str, uid_hex: str) -> None:
    low = text.lower()
    for s in _all_dev_secrets(uid_hex):
        assert s not in low


def test_encode_requires_roots(monkeypatch):
    monkeypatch.delenv("NFC_LOCAL_SDM_ROOT_KEY", raising=False)
    monkeypatch.delenv("NFC_LOCAL_ADMIN_ROOT_KEY", raising=False)
    with pytest.raises(SystemExit):
        main(["encode", "--item", "abc"])


def test_env_roots_still_need_allow_flag(monkeypatch):
    monkeypatch.setenv("NFC_LOCAL_SDM_ROOT_KEY", "11" * 32)
    monkeypatch.setenv("NFC_LOCAL_ADMIN_ROOT_KEY", "22" * 32)
    monkeypatch.delenv("NFC_ALLOW_LOCAL_KEYS", raising=False)
    with pytest.raises(PermissionError):
        main(["encode", "--item", "abc"])


def test_encode_json_output_has_no_keys(capsys):
    rc = main(["encode", "--item", "abc", "--counter", "3", "--dev-roots"])
    assert rc == 0
    cap = capsys.readouterr()
    out = json.loads(cap.out)
    assert out["item"] == "abc" and out["counter"] == 3 and out["keyVersion"] == 1
    assert len(out["uid"]) == 14 and out["uid"].startswith("04")
    assert out["sunUrl"].startswith("https://authentic-materials.com/verify/abc?picc_data=")
    assert not any("key" in k.lower() and k != "keyVersion" for k in out)
    _assert_no_secrets(cap.out + cap.err, out["uid"])


def test_dry_run_prints_sequence_but_no_keys(capsys):
    rc = main(["encode", "--item", "abc", "--uid", UID, "--dry-run", "--dev-roots"])
    assert rc == 0
    cap = capsys.readouterr()
    assert "DRY RUN" in cap.out and "AuthenticateEV2First" in cap.out
    assert "[secure session]" in cap.out and "SUN URL" in cap.out
    assert "never printed" in cap.out
    assert "cleartext body: 4000E0C1FF23" in cap.out  # SDM settings with encrypted PICCData
    _assert_no_secrets(cap.out + cap.err, UID)


def test_encode_then_verify_roundtrip(capsys):
    assert main(["encode", "--item", "x", "--uid", UID, "--counter", "7", "--dev-roots"]) == 0
    out = json.loads(capsys.readouterr().out)
    rc = main(["verify", "--uid", UID, "--picc", out["encPiccHex"], "--cmac", out["cmacHex"],
               "--last-counter", "6", "--dev-roots"])
    cap = capsys.readouterr()
    assert rc == 0
    res = json.loads(cap.out)
    assert res == {"valid": True, "decryptedUid": UID, "counterValue": 7}
    _assert_no_secrets(cap.out + cap.err, UID)


def _enc(counter=5):
    main(["encode", "--item", "x", "--uid", UID, "--counter", str(counter), "--dev-roots"])


def test_verify_rejects_replay(capsys):
    _enc()
    out = json.loads(capsys.readouterr().out)
    rc = main(["verify", "--uid", UID, "--picc", out["encPiccHex"], "--cmac", out["cmacHex"],
               "--last-counter", "5", "--dev-roots"])
    assert rc == 1
    assert json.loads(capsys.readouterr().out)["error"] == "replay_detected"


def test_verify_rejects_bad_mac(capsys):
    _enc()
    out = json.loads(capsys.readouterr().out)
    rc = main(["verify", "--uid", UID, "--picc", out["encPiccHex"], "--cmac", "0000000000000000",
               "--last-counter", "4", "--dev-roots"])
    assert rc == 1
    assert json.loads(capsys.readouterr().out)["error"] == "invalid_signature"


def test_verify_rejects_other_uid(capsys):
    _enc()
    out = json.loads(capsys.readouterr().out)
    rc = main(["verify", "--uid", "04DE5F1EACC040", "--picc", out["encPiccHex"], "--cmac", out["cmacHex"],
               "--dev-roots"])
    assert rc == 1
    assert json.loads(capsys.readouterr().out)["error"] == "uid_mismatch"


def test_read_roundtrips_encoded_ndef(capsys):
    _enc(1)
    out = json.loads(capsys.readouterr().out)
    assert main(["read", "--ndef", out["ndefBytes"]]) == 0
    assert json.loads(capsys.readouterr().out)["uri"] == out["sunUrl"]


# --- S-NFC2 Phase 2: personalise -------------------------------------------------


def test_personalise_emulator_single_chip(capsys, tmp_path):
    audit = tmp_path / "audit.jsonl"
    rc = main(["personalise", "--item", "item_ph2", "--emulator", "--dev-roots", "--audit-log", str(audit)])
    out = capsys.readouterr().out
    assert rc == 0
    assert "EMULATOR" in out and "✓ ENCODED" in out and "1 encoded, 0 not encoded" in out
    assert '"result": "encoded"' in audit.read_text()


def test_personalise_emulator_batch(capsys, tmp_path):
    manifest = tmp_path / "lot.csv"
    manifest.write_text("item,token\nitem_a,tok_a\nitem_b,\n\nitem_c,tok_c\n")
    rc = main(["personalise", "--batch", str(manifest), "--emulator", "--dev-roots",
               "--audit-log", str(tmp_path / "a.jsonl")])
    out = capsys.readouterr().out
    assert rc == 0 and "3 encoded, 0 not encoded" in out
    assert "token=item_b" in out  # empty token falls back to the item id


def test_personalise_refuses_dev_roots_on_real_silicon(tmp_path):
    with pytest.raises(SystemExit) as exc:
        main(["personalise", "--item", "x", "--dev-roots", "--audit-log", str(tmp_path / "a.jsonl")])
    assert "PUBLIC" in str(exc.value)


def test_personalise_needs_item_or_batch(tmp_path):
    with pytest.raises(SystemExit):
        main(["personalise", "--emulator", "--dev-roots", "--audit-log", str(tmp_path / "a.jsonl")])
