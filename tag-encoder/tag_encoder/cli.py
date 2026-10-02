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
import json
import os
import sys

from .keyprovider import ROLE_APP_MASTER, ROLE_FILE, ROLE_META, KeyProvider, LocalKeyProvider
from .ntag424 import apdu as apdu_mod
from .ntag424.encode import build_sdm_template, encode_sun, verify_sun

DEFAULT_BASE_URL = "https://authentic-materials.com"
DEFAULT_KEY_VERSION = 1

# PUBLIC dev roots. Deliberately recognisable; anything encoded under them is
# forgeable by anyone who reads this file. Opt-in only via --dev-roots.
_DEV_SDM_ROOT = bytes.fromhex("D0" * 32)
_DEV_ADMIN_ROOT = bytes.fromhex("DA" * 32)


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

    meta_key = provider.derive_key(ROLE_META, args.key_version)
    file_key = provider.derive_key(ROLE_FILE, args.key_version, uid)
    result = encode_sun(uid, args.counter, meta_key, file_key, args.base_url, token)
    del meta_key, file_key  # no references survive the command

    if args.dry_run:
        # The APP_MASTER key is exercised (derivable) but never shown.
        provider.derive_key(ROLE_APP_MASTER, args.key_version, uid)
        template = build_sdm_template(args.base_url, token)
        seq = apdu_mod.encode_apdu_sequence(
            ndef_bytes=template.ndef_bytes,
            picc_data_offset=template.picc_data_offset,
            sdm_mac_input_offset=template.sdm_mac_input_offset,
            sdm_mac_offset=template.sdm_mac_offset,
            key_version=args.key_version,
        )
        print("=== DRY RUN — no reader, nothing written ===")
        print(f"item={args.item}  uid={uid_hex}  counter={args.counter}  keyVersion={args.key_version}")
        print("keys: K0 APP_MASTER / K2 META / K3 FILE derived in memory — not printed")
        print(f"SDM offsets: PICCData={template.picc_data_offset} MACInput={template.sdm_mac_input_offset} "
              f"MAC={template.sdm_mac_offset}")
        print(f"SUN URL (simulated tap): {result.sun_url}")
        print(f"NDEF template: {template.ndef_bytes.hex().upper()}")
        print()
        print("APDU SEQUENCE (AN12196 EV2):")
        for i, step in enumerate(seq, 1):
            live = " [REQUIRES LIVE CHANNEL — Phase 2]" if step.get("requires_live_channel") else ""
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


def cmd_verify(args: argparse.Namespace) -> int:
    provider = _provider(args)
    meta_key = provider.derive_key(ROLE_META, args.key_version)
    res = verify_sun(
        args.picc,
        args.cmac,
        meta_key,
        lambda uid: provider.derive_key(ROLE_FILE, args.key_version, uid),
        args.last_counter,
        args.uid,
    )
    del meta_key
    out: dict = {"valid": res.valid, "decryptedUid": res.uid_hex, "counterValue": res.counter}
    if res.error:
        out["error"] = res.error
    print(json.dumps(out, indent=2))
    return 0 if res.valid else 1


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
    key_args(vf)
    vf.set_defaults(func=cmd_verify)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
