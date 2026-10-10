"""CLI tests (S-NFC3.5): encode / dry-run / read / verify, and NO key material on stdout/stderr."""

import json

import pytest

from tag_encoder import cli
from tag_encoder.cli import main
from tag_encoder.keyprovider import LocalKeyProvider

UID = "04A27E02936980"
SERIAL = "5A1E7C0D93B2468F"


def _all_dev_secrets(uid_hex: str, serial_hex: str | None = None) -> list[str]:
    """Every root and derived key the CLI could touch for this chip, as lowercase hex."""
    p = LocalKeyProvider(cli._DEV_SDM_ROOT, cli._DEV_ADMIN_ROOT, allow_local_keys=True)
    uid = bytes.fromhex(uid_hex)
    out = [cli._DEV_SDM_ROOT.hex(), cli._DEV_ADMIN_ROOT.hex()]
    out += [p.derive_key("META", 1).hex(), p.derive_key("FILE", 1, uid).hex(), p.derive_key("APP_MASTER", 1, uid).hex()]
    if serial_hex:
        sn = bytes.fromhex(serial_hex)
        out.append(p.derive_key("META", 2).hex())
        for role in ("FILE", "APP_MASTER", "APP_KEY1", "APP_KEY4"):
            out.append(p.derive_key(role, 2, uid, sn).hex())
    return out


def _assert_no_secrets(text: str, uid_hex: str, serial_hex: str | None = None) -> None:
    low = text.lower()
    for s in _all_dev_secrets(uid_hex, serial_hex):
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
    assert out["item"] == "abc" and out["counter"] == 3 and out["keyVersion"] == 2
    assert len(out["uid"]) == 14 and out["uid"].startswith("04")
    assert len(out["serial"]) == 16
    assert out["sunUrl"].startswith(f"https://authentic-materials.com/verify/abc?sn={out['serial']}&picc_data=")
    assert not any("key" in k.lower() and k != "keyVersion" for k in out)
    _assert_no_secrets(cap.out + cap.err, out["uid"], out["serial"])


def test_encode_v1_has_no_serial(capsys):
    assert main(["encode", "--item", "abc", "--key-version", "1", "--dev-roots"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["serial"] is None and "?picc_data=" in out["sunUrl"]


def test_dry_run_prints_sequence_but_no_keys(capsys):
    rc = main(["encode", "--item", "abc", "--uid", UID, "--serial", SERIAL, "--dry-run", "--dev-roots"])
    assert rc == 0
    cap = capsys.readouterr()
    assert "ChangeKey K1 (APP_KEY1)" in cap.out and "ChangeKey K4 (APP_KEY4)" in cap.out
    assert "unauthenticated" in cap.out  # the serial is written before any key change
    assert "DRY RUN" in cap.out and "AuthenticateEV2First" in cap.out
    assert "[secure session]" in cap.out and "SUN URL" in cap.out
    assert "never printed" in cap.out
    assert "cleartext body: 4000E0C1FF23" in cap.out  # SDM settings with encrypted PICCData
    _assert_no_secrets(cap.out + cap.err, UID, SERIAL)


def test_encode_then_verify_roundtrip(capsys):
    assert main(["encode", "--item", "x", "--uid", UID, "--counter", "7", "--dev-roots"]) == 0
    out = json.loads(capsys.readouterr().out)
    rc = main(["verify", "--uid", UID, "--picc", out["encPiccHex"], "--cmac", out["cmacHex"],
               "--serial", out["serial"], "--last-counter", "6", "--dev-roots"])
    cap = capsys.readouterr()
    assert rc == 0
    res = json.loads(cap.out)
    assert res == {"valid": True, "decryptedUid": UID, "counterValue": 7}
    _assert_no_secrets(cap.out + cap.err, UID, out["serial"])


def test_verify_v2_needs_the_serial(capsys):
    _enc()
    out = json.loads(capsys.readouterr().out)
    with pytest.raises(SystemExit):
        main(["verify", "--picc", out["encPiccHex"], "--cmac", out["cmacHex"], "--dev-roots"])


def test_verify_rejects_other_serial(capsys):
    """Same UID, other chip's serial: other keys, so the MAC fails."""
    _enc()
    out = json.loads(capsys.readouterr().out)
    rc = main(["verify", "--uid", UID, "--picc", out["encPiccHex"], "--cmac", out["cmacHex"],
               "--serial", "C3D24B19E0F7A651", "--last-counter", "4", "--dev-roots"])
    assert rc == 1
    assert json.loads(capsys.readouterr().out)["error"] == "invalid_signature"


def _enc(counter=5):
    main(["encode", "--item", "x", "--uid", UID, "--serial", SERIAL, "--counter", str(counter), "--dev-roots"])


def test_verify_rejects_replay(capsys):
    _enc()
    out = json.loads(capsys.readouterr().out)
    rc = main(["verify", "--uid", UID, "--picc", out["encPiccHex"], "--cmac", out["cmacHex"],
               "--serial", SERIAL, "--last-counter", "5", "--dev-roots"])
    assert rc == 1
    assert json.loads(capsys.readouterr().out)["error"] == "replay_detected"


def test_verify_rejects_bad_mac(capsys):
    _enc()
    out = json.loads(capsys.readouterr().out)
    rc = main(["verify", "--uid", UID, "--picc", out["encPiccHex"], "--cmac", "0000000000000000",
               "--serial", SERIAL, "--last-counter", "4", "--dev-roots"])
    assert rc == 1
    assert json.loads(capsys.readouterr().out)["error"] == "invalid_signature"


def test_verify_rejects_other_uid(capsys):
    _enc()
    out = json.loads(capsys.readouterr().out)
    rc = main(["verify", "--uid", "04DE5F1EACC040", "--picc", out["encPiccHex"], "--cmac", out["cmacHex"],
               "--serial", SERIAL, "--dev-roots"])
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


def test_personalise_without_a_name_auto_names_the_chip(capsys, tmp_path):
    audit = tmp_path / "a.jsonl"
    rc = main(["personalise", "--emulator", "--dev-roots", "--audit-log", str(audit)])
    out = capsys.readouterr().out
    assert rc == 0
    assert "token=(next chip_NNN)" in out and "✓ ENCODED  chip_001 " in out
    assert "/verify/chip_001?sn=" in out
    record = json.loads(audit.read_text().splitlines()[-1])
    assert record["item"] == "chip_001" and record["token"] == "chip_001" and record["result"] == "encoded"


def test_personalise_token_alone_names_the_chip(capsys, tmp_path):
    rc = main(["personalise", "--token", "gold_run_01", "--emulator", "--dev-roots",
               "--audit-log", str(tmp_path / "a.jsonl")])
    assert rc == 0 and "✓ ENCODED  gold_run_01 " in capsys.readouterr().out


def test_personalise_batch_refuses_a_repeated_name(capsys, tmp_path):
    manifest = tmp_path / "lot.csv"
    manifest.write_text("item\nitem_a\nitem_a\n")
    rc = main(["personalise", "--batch", str(manifest), "--emulator", "--dev-roots",
               "--audit-log", str(tmp_path / "a.jsonl")])
    out = capsys.readouterr().out
    assert rc == 1 and "1 encoded, 1 not encoded" in out
    assert "REFUSED (nothing written)" in out and "name_taken" in out


def test_personalise_batch_does_not_mix_with_item(tmp_path):
    manifest = tmp_path / "lot.csv"
    manifest.write_text("item\nitem_a\n")
    with pytest.raises(SystemExit) as exc:
        main(["personalise", "--batch", str(manifest), "--item", "x", "--emulator", "--dev-roots",
              "--audit-log", str(tmp_path / "a.jsonl")])
    assert "--batch" in str(exc.value)