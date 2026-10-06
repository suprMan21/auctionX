"""tag-encoder CLI — encode / read / verify (S-NFC3.5: real AN12196 SDM).

Commands:
    encode --item <id> [--uid HEX] [--counter N] [--base-url URL] [--dry-run]
        Derive the chip keys (KeyProvider), simulate the tap a personalised
        chip would produce, and print the SUN URL + NDEF image. `--dry-run`
        ALSO prints the personalisation APDU sequence (no reader needed) and
        writes nothing.

    read --ndef HEX
        Parse an NDEF file image back to its URI, reusing tag-hq's parser.

    verify --picc HEX --cmac HEX [--uid HEX] [--last-counter N]
        Run the backend's validateSunScan logic: decrypt PICCData under the
        META key, check the claimed UID, verify the SDMMAC, check the counter.

    personalise --item <id> [--token T] [--base-url URL] [--batch CSV] [--emulator]
        S-NFC2 Phase 2: physically key + write a chip on the PC/SC reader, read it
        back, verify the SUN, then enroll it (personalise.py has the 9 stages).
        Real chips: KMS keys + staff login (env) ONLY. --emulator rehearses the
        whole flow on a software chip with an in-memory registry.

    tapcheck --url URL
        POST a SUN URL read by a phone to the backend's /nfc/scan (staging e2e).

KEYS: derived from roots via a KeyProvider and held in memory for one command.
They are NEVER printed, written to a file, or put in JSON output. Roots come
from the environment (staging/dev):
    NFC_LOCAL_SDM_ROOT_KEY, NFC_LOCAL_ADMIN_ROOT_KEY  (64 hex chars each)
or, for offline demos/tests only, `--dev-roots` (fixed, PUBLIC, worthless
roots — never use for a customer chip). Production encodes use the KMS
provider (providers/kms_key_provider.py).

NOTE: any future local server MUST bind to 127.0.0.1 only.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import urllib.error
import urllib.request

# tag-hq's read-only parsers + originality check are reused; make the sibling
# package importable when running from a checkout (`python -m tag_encoder.cli`).
_SIBLING_TAG_HQ = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "tag-hq")
if os.path.isdir(_SIBLING_TAG_HQ) and _SIBLING_TAG_HQ not in sys.path:
    sys.path.append(_SIBLING_TAG_HQ)

from .keyprovider import (
    ROLE_APP_MASTER,
    ROLE_FILE,
    ROLE_META,
    SERIAL_KDF_VERSION,
    KeyProvider,
    LocalKeyProvider,
)
from .ntag424 import apdu as apdu_mod
from .ntag424.encode import build_sdm_template, encode_sun, verify_sun

DEFAULT_BASE_URL = "https://authentic-materials.com"
# Chips keyed under the STAGING KMS roots point at the staging frontend: the
# production domain will never verify staging keys.
STAGING_BASE_URL = "https://d1bwev65w7rqzl.cloudfront.net"
DEFAULT_KEY_VERSION = 2  # S-NFC-ID KDF v2: per-chip serial in the URL and the keys

# PUBLIC dev roots. Deliberately recognisable; anything encoded under them is
# forgeable by anyone who reads this file. Opt-in only via --dev-roots.
_DEV_SDM_ROOT = bytes.fromhex("D0" * 32)
_DEV_ADMIN_ROOT = bytes.fromhex("DA" * 32)


def _default_audit_path():
    from .audit import DEFAULT_AUDIT_PATH

    return DEFAULT_AUDIT_PATH


def _hex_to_apdu_str(apdu: list[int]) -> str:
    return " ".join(f"{b:02X}" for b in apdu)


def _derive_uid_for_item(item_id: str) -> str:
    """Deterministic placeholder 7-byte UID from an item id (SIM only).

    Real UIDs come from the silicon (GetVersion via tag-hq). Starts 0x04 (NXP).
    """
    import hashlib

    return ("04" + hashlib.sha256(b"AM-ITEM-UID\x01" + item_id.encode("utf-8")).digest()[:6].hex()).upper()


def _provider(args: argparse.Namespace) -> KeyProvider:
    if getattr(args, "dev_roots", False):
        print("WARNING: --dev-roots uses PUBLIC roots; output is NOT secure.", file=sys.stderr)
        return LocalKeyProvider(_DEV_SDM_ROOT, _DEV_ADMIN_ROOT, allow_local_keys=True)
    sdm = os.environ.get("NFC_LOCAL_SDM_ROOT_KEY", "")
    admin = os.environ.get("NFC_LOCAL_ADMIN_ROOT_KEY", "")
    if len(sdm) != 64 or len(admin) != 64:
        raise SystemExit(
            "error: set NFC_LOCAL_SDM_ROOT_KEY and NFC_LOCAL_ADMIN_ROOT_KEY (64 hex each), "
            "or pass --dev-roots for an offline demo"
        )
    allow = os.environ.get("NFC_ALLOW_LOCAL_KEYS", "false") == "true"
    return LocalKeyProvider(bytes.fromhex(sdm), bytes.fromhex(admin), allow_local_keys=allow)


def cmd_encode(args: argparse.Namespace) -> int:
    provider = _provider(args)
    uid_hex = (args.uid or _derive_uid_for_item(args.item)).upper()
    uid = bytes.fromhex(uid_hex)
    token = args.token or args.item

    serial = _serial_arg(args)

    meta_key = provider.derive_key(ROLE_META, args.key_version)
    file_key = provider.derive_key(ROLE_FILE, args.key_version, uid, serial)
    result = encode_sun(uid, args.counter, meta_key, file_key, args.base_url, token, serial=serial)
    del meta_key, file_key  # no references survive the command

    if args.dry_run:
        # The APP_MASTER key is exercised (derivable) but never shown.
        provider.derive_key(ROLE_APP_MASTER, args.key_version, uid, serial)
        template = build_sdm_template(args.base_url, token, serial)
        seq = apdu_mod.encode_apdu_sequence(
            ndef_bytes=template.ndef_bytes,
            picc_data_offset=template.picc_data_offset,
            sdm_mac_input_offset=template.sdm_mac_input_offset,
            sdm_mac_offset=template.sdm_mac_offset,
            key_version=args.key_version,
            serial_kdf=serial is not None,
        )
        print("=== DRY RUN — no reader, nothing written ===")
        print(f"item={args.item}  uid={uid_hex}  counter={args.counter}  keyVersion={args.key_version}")
        spare = " / K1+K4 APP_KEY1/4" if serial is not None else ""
        print(f"keys: K0 APP_MASTER / K2 META / K3 FILE{spare} derived in memory — not printed")
        print(f"SDM offsets: PICCData={template.picc_data_offset} MACInput={template.sdm_mac_input_offset} "
              f"MAC={template.sdm_mac_offset}")
        print(f"SUN URL (simulated tap): {result.sun_url}")
        print(f"NDEF template: {template.ndef_bytes.hex().upper()}")
        print()
        print("APDU SEQUENCE (AN12196 EV2):")
        for i, step in enumerate(seq, 1):
            live = " [secure session]" if step.get("requires_live_channel") else ""
            print(f"  {i}. {step['name']}{live}")
            if "apdu" in step:
                print(f"       APDU: {_hex_to_apdu_str(step['apdu'])}")
            if "plain_framed_apdu" in step:
                print(f"       APDU(plain framing): {_hex_to_apdu_str(step['plain_framed_apdu'])}")
            if "cleartext_body_hex" in step:
                print(f"       cleartext body: {step['cleartext_body_hex']}")
            if "cleartext_layout" in step:
                print(f"       cleartext layout: {step['cleartext_layout']}")
            if "note" in step:
                print(f"       note: {step['note']}")
        return 0

    out = {
        "item": args.item,
        "uid": uid_hex,
        "counter": args.counter,
        "keyVersion": args.key_version,
        "serial": serial.hex().upper() if serial is not None else None,
        "baseUrl": args.base_url,
        "tokenName": token,
        **result.as_dict(),
    }
    print(json.dumps(out, indent=2))
    return 0


def cmd_read(args: argparse.Namespace) -> int:
    data = bytes.fromhex(args.ndef)
    try:
        from tag_hq import parsers  # type: ignore

        summary = parsers.parse_ndef(data)
        print(json.dumps({"nlen": summary.nlen if summary else None, "uri": summary.uri if summary else None,
                          "is_sdm_mirror": summary.is_sdm_mirror if summary else None}, indent=2))
        return 0
    except ImportError:
        pass
    if len(data) < 2:
        print("error: NDEF image too short", file=sys.stderr)
        return 1
    nlen = int.from_bytes(data[0:2], "big")
    msg = data[2 : 2 + nlen]
    from .ndef import URI_PREFIXES

    uri = None
    if len(msg) >= 4 and msg[1] == 0x01 and msg[3:4] == b"U":
        payload = msg[4 : 4 + msg[2]]
        uri = URI_PREFIXES.get(payload[0], "") + payload[1:].decode("utf-8", "replace")
    print(json.dumps({"nlen": nlen, "uri": uri}, indent=2))
    return 0


def _serial_arg(args: argparse.Namespace) -> bytes | None:
    """v2 needs an 8-byte serial: --serial, else (encode only) a fresh random one."""
    if args.key_version < SERIAL_KDF_VERSION:
        if getattr(args, "serial", None):
            raise SystemExit("error: --serial is only valid with --key-version >= 2")
        return None
    if getattr(args, "serial", None):
        try:
            raw = bytes.fromhex(args.serial)
        except ValueError:
            raw = b""
        if len(raw) != 8:
            raise SystemExit("error: --serial must be 16 hex chars (8 bytes)")
        return raw
    if args.command == "verify":
        raise SystemExit("error: --serial is required with --key-version >= 2 (the sn= value from the URL)")
    return os.urandom(8)


def cmd_verify(args: argparse.Namespace) -> int:
    provider = _provider(args)
    serial = _serial_arg(args)
    meta_key = provider.derive_key(ROLE_META, args.key_version)
    res = verify_sun(
        args.picc,
        args.cmac,
        meta_key,
        lambda uid: provider.derive_key(ROLE_FILE, args.key_version, uid, serial),
        args.last_counter,
        args.uid,
        serial,
    )
    del meta_key
    out: dict = {"valid": res.valid, "decryptedUid": res.uid_hex, "counterValue": res.counter}
    if res.error:
        out["error"] = res.error
    print(json.dumps(out, indent=2))
    return 0 if res.valid else 1


def _personalise_jobs(args: argparse.Namespace) -> list:
    from .personalise import EncodeJob

    if not args.batch:
        if not args.item:
            raise SystemExit("error: --item or --batch is required")
        return [EncodeJob(args.item, args.token or args.item, args.base_url, args.key_version)]
    with open(args.batch, newline="", encoding="utf-8") as fh:
        rows = [r for r in csv.DictReader(fh) if (r.get("item") or "").strip()]
    if not rows:
        raise SystemExit(f"error: {args.batch} has no rows with an 'item' column")
    return [
        EncodeJob(r["item"].strip(), (r.get("token") or r["item"]).strip(), args.base_url, args.key_version)
        for r in rows
    ]


def cmd_personalise(args: argparse.Namespace) -> int:
    from .audit import AuditLog
    from .ntag424.emulator import EmulatedNtag424
    from .personalise import EncodeError, Refused, personalise
    from .registry import MemoryRegistry, RegistryError, backend_registry_from_env

    jobs = _personalise_jobs(args)
    audit = AuditLog(args.audit_log)

    if args.emulator:
        provider = _provider(args)
        registry = MemoryRegistry()
        originality = lambda uid, sig: True  # noqa: E731 - a software chip has no NXP signature
        mode = "emulator"
        print("EMULATOR: software chip, in-memory registry. Nothing touches silicon or the backend.")
    else:
        if args.dev_roots:
            raise SystemExit("error: --dev-roots are PUBLIC; they may never key a physical chip")
        from providers.kms_key_provider import KmsKeyProvider

        from .personalise import nxp_originality
        from .transport import PcscCard

        try:
            provider = KmsKeyProvider(validate_on_init=True)
            registry = backend_registry_from_env()
        except RegistryError as exc:
            raise SystemExit(f"error: {exc}")
        originality, mode = nxp_originality, "pcsc"
        print(f"LIVE ENCODE  keys: KMS {provider.key_ids['sdm']} + {provider.key_ids['admin']} ({provider.region})")
        print(f"             registry: {registry.api_base}   base URL: {args.base_url}")
        print(f"             audit: {audit.path}")

    failures = 0
    for n, job in enumerate(jobs, 1):
        print(f"\n[{n}/{len(jobs)}] item={job.item} token={job.token}")
        if args.emulator:
            card = EmulatedNtag424(uid=bytes.fromhex(_derive_uid_for_item(job.item)))
        else:
            if not args.yes:
                answer = input("  Place a BLANK chip on the reader, then Enter (s = skip, q = quit): ").strip().lower()
                if answer == "q":
                    break
                if answer == "s":
                    continue
            try:
                card = PcscCard.connect(args.reader)
            except Exception as exc:
                print(f"  ✗ reader: {exc}")
                failures += 1
                continue
        try:
            out = personalise(card, provider, registry, job, audit=audit, originality=originality, mode=mode)
        except EncodeError as exc:
            failures += 1
            kind = "REFUSED (nothing written)" if isinstance(exc, Refused) else "FAILED (re-run this chip to resume)"
            print(f"  ✗ {kind}: {exc}")
            continue
        finally:
            if hasattr(card, "close"):
                card.close()
        print(f"  ✓ ENCODED  tag {out.tag_id}  UID {out.uid_hex}  read-back ctr {out.readback_counter}"
              f"{'  (resumed)' if out.resumed else ''}")
        print(f"    read-back URL: {out.readback_url}")
        if not args.emulator and not args.yes and len(jobs) > 1:
            input("  Remove the chip, then Enter: ")

    print(f"\n{len(jobs) - failures} encoded, {failures} not encoded")
    return 0 if failures == 0 else 1


def cmd_tapcheck(args: argparse.Namespace) -> int:
    """Phone-tap e2e: send the URL a phone read to the backend's public /nfc/scan."""
    from .registry import DEFAULT_API_BASE

    api = os.environ.get("AM_API_BASE", DEFAULT_API_BASE).rstrip("/")
    req = urllib.request.Request(
        api + "/api/v1/nfc/scan",
        data=json.dumps({"sunMessage": args.url}).encode(),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            status, body = resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        status, body = exc.code, exc.read()
    print(f"HTTP {status}")
    try:
        print(json.dumps(json.loads(body), indent=2))
    except ValueError:
        print(body.decode("utf-8", "replace"))
    return 0 if status == 200 else 1


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="tag-encoder", description="NTAG 424 DNA encoder (AN12196 SDM)")
    sub = p.add_subparsers(dest="command", required=True)

    def key_args(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--dev-roots", action="store_true", help="use PUBLIC dev roots (offline demo only)")
        sp.add_argument("--key-version", type=int, default=DEFAULT_KEY_VERSION, help="KDF key version 1..255")

    enc = sub.add_parser("encode", help="encode a SUN payload for an item")
    enc.add_argument("--item", required=True, help="item id (token name + UID seed)")
    enc.add_argument("--uid", help="explicit 7-byte UID hex (14 chars); else derived from item")
    enc.add_argument("--counter", type=int, default=1, help="SDMReadCtr for the simulated tap (0..16777215)")
    enc.add_argument("--token", help="SUN token name (defaults to --item)")
    enc.add_argument("--base-url", default=DEFAULT_BASE_URL, help="SUN base URL")
    enc.add_argument("--dry-run", action="store_true", help="print APDU sequence + SUN, write nothing")
    enc.add_argument("--serial", help="v2 chip serial, 16 hex chars (default: random)")
    key_args(enc)
    enc.set_defaults(func=cmd_encode)

    rd = sub.add_parser("read", help="parse an NDEF file image back to its URI")
    rd.add_argument("--ndef", required=True, help="NDEF file image hex (NLEN || message)")
    rd.set_defaults(func=cmd_read)

    vf = sub.add_parser("verify", help="verify a SUN PICC+CMAC against backend logic")
    vf.add_argument("--uid", help="claimed 7-byte UID hex (optional)")
    vf.add_argument("--picc", required=True, help="ENCPICCData hex (32 chars)")
    vf.add_argument("--cmac", required=True, help="SDMMAC hex (16 chars)")
    vf.add_argument("--last-counter", type=int, default=-1, help="last accepted counter (replay gate)")
    vf.add_argument("--serial", help="v2 chip serial: the sn= value from the URL (16 hex chars)")
    key_args(vf)
    vf.set_defaults(func=cmd_verify)

    ps = sub.add_parser("personalise", help="physically encode chip(s) on the reader (S-NFC2 Ph2)")
    ps.add_argument("--item", help="item id (an items.id UUID is linked at enroll; any other label is audit-only)")
    ps.add_argument("--token", help="SUN token name in the URL path (defaults to --item)")
    ps.add_argument("--batch", help="CSV with an 'item' column (optional 'token'); one chip per row")
    ps.add_argument("--base-url", default=STAGING_BASE_URL, help="SUN base URL (default: staging frontend)")
    ps.add_argument("--reader", help="substring of the PC/SC reader name (default: first PICC reader)")
    ps.add_argument("--audit-log", default=str(_default_audit_path()), help="append-only JSONL audit ledger")
    ps.add_argument("--emulator", action="store_true", help="rehearse on a software chip (no reader, no backend)")
    ps.add_argument("--yes", action="store_true", help="no per-chip prompts (chip must already be on the reader)")
    key_args(ps)
    ps.set_defaults(func=cmd_personalise)

    tc = sub.add_parser("tapcheck", help="POST a phone-read SUN URL to the backend /nfc/scan")
    tc.add_argument("--url", required=True, help="the full URL the phone opened")
    tc.set_defaults(func=cmd_tapcheck)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
