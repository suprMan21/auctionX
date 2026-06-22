"""tag-encoder CLI — encode / read / verify (Phase 1, SIM-ONLY).

Commands:
    encode --item <id> [--uid HEX] [--counter N] [--base-url URL] [--dry-run]
        Derive the per-tag key (LocalStubKeyProvider), run the pure encode
        pipeline, and print the SUN URL + NDEF image. `--dry-run` ALSO prints
        the full APDU sequence (no reader needed) and writes nothing.

    read --ndef HEX
        Parse an NDEF file image back to its URI (round-trip of the builder),
        reusing tag-hq's parser when importable.

    verify --uid HEX --key HEX --picc HEX --cmac HEX [--last-counter N]
        Decrypt PICCData + verify the truncated CMAC against the same logic the
        backend uses (mirror of validateScan), and report the recovered counter.

NOTE: any future local server (Phase 3) MUST bind to 127.0.0.1 only — there is
no server here, but the convention is pinned so it isn't forgotten.

Hardware writes (ChangeKey / ChangeFileSettings / MACed WriteData) require a
live EV2 secure channel and are Phase 2; this CLI never touches a reader.
"""

from __future__ import annotations

import argparse
import json
import sys

from .keyprovider import LocalStubKeyProvider
from .ntag424 import apdu as apdu_mod
from .ntag424.encode import decrypt_picc_data, encode_sun, truncated_cmac_hex

DEFAULT_BASE_URL = "https://authentic-materials.com"
# Phase 1 SIM uses a simplified SUN; SDM mirror offsets are placeholders for the
# Phase-2 ChangeFileSettings template (where the card writes UID/CTR/MAC).
DEFAULT_PICC_OFFSET = 0x20
DEFAULT_SDM_MAC_INPUT_OFFSET = 0x40
DEFAULT_SDM_MAC_OFFSET = 0x50


def _hex_to_apdu_str(apdu: list[int]) -> str:
    return " ".join(f"{b:02X}" for b in apdu)


def _derive_uid_for_item(item_id: str) -> str:
    """Deterministic placeholder 7-byte UID from an item id (SIM only).

    Real UIDs come from the silicon (GetVersion/GetCardUID via tag-hq). For
    offline dry-runs we synthesize a stable UID so the same item always maps to
    the same SUN — starts 0x04 (NXP) like a genuine UID.
    """
    from .aes import aes128_cmac

    seed = aes128_cmac(bytes(16), b"AM-ITEM-UID\x01" + item_id.encode("utf-8"))
    return ("04" + seed[:6].hex()).upper()


def cmd_encode(args: argparse.Namespace) -> int:
    provider = LocalStubKeyProvider()
    uid_hex = (args.uid or _derive_uid_for_item(args.item)).upper()
    key = provider.derive_tag_key(bytes.fromhex(uid_hex))
    token = args.token or args.item

    result = encode_sun(uid_hex, args.counter, key, args.base_url, token)

    out = {
        "item": args.item,
        "uid": uid_hex,
        "counter": args.counter,
        "keyHex": key.hex().upper(),
        "baseUrl": args.base_url,
        "tokenName": token,
        **result.as_dict(),
    }

    if args.dry_run:
        seq = apdu_mod.encode_apdu_sequence(
            new_key=key,
            ndef_bytes=result.ndef_bytes,
            picc_data_offset=DEFAULT_PICC_OFFSET,
            sdm_mac_input_offset=DEFAULT_SDM_MAC_INPUT_OFFSET,
            sdm_mac_offset=DEFAULT_SDM_MAC_OFFSET,
        )
        print("=== DRY RUN — no reader, nothing written ===")
        print(f"item={args.item}  uid={uid_hex}  counter={args.counter}")
        print(f"keyHex={key.hex().upper()}  (per-UID derived; not a master key)")
        print(f"SUN URL: {result.sun_url}")
        print(f"NDEF   : {result.ndef_bytes.hex().upper()}")
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
            if "note" in step:
                print(f"       note: {step['note']}")
        return 0

    print(json.dumps(out, indent=2))
    return 0


def cmd_read(args: argparse.Namespace) -> int:
    data = bytes.fromhex(args.ndef)
    uri = None
    # Prefer tag-hq's authoritative parser if it is importable.
    try:
        from tag_hq import parsers  # type: ignore

        summary = parsers.parse_ndef(data)
        uri = summary.uri if summary else None
        print(json.dumps({"nlen": summary.nlen if summary else None, "uri": uri,
                          "is_sdm_mirror": summary.is_sdm_mirror if summary else None}, indent=2))
        return 0
    except Exception:
        pass
    # Fallback: minimal local parse (NLEN + single URI record).
    if len(data) < 2:
        print("error: NDEF image too short", file=sys.stderr)
        return 1
    nlen = int.from_bytes(data[0:2], "big")
    msg = data[2 : 2 + nlen]
    from .ndef import URI_PREFIXES

    if len(msg) >= 4 and msg[1] == 0x01 and msg[3:4] == b"U":
        payload = msg[4 : 4 + msg[2]]
        uri = URI_PREFIXES.get(payload[0], "") + payload[1:].decode("utf-8", "replace")
    print(json.dumps({"nlen": nlen, "uri": uri}, indent=2))
    return 0


def cmd_verify(args: argparse.Namespace) -> int:
    """Mirror of backend validateScan: decrypt PICC -> check UID -> verify CMAC -> counter."""
    decrypted = decrypt_picc_data(args.picc, args.key)
    if decrypted is None:
        print(json.dumps({"valid": False, "error": "Failed to decrypt PICCData"}, indent=2))
        return 1
    uid, counter = decrypted
    if args.uid and uid.upper() != args.uid.upper():
        print(json.dumps({"valid": False, "decryptedUid": uid, "counterValue": counter,
                          "error": "UID mismatch"}, indent=2))
        return 1
    expected = truncated_cmac_hex(args.picc, args.key)
    if expected.upper() != args.cmac.upper():
        print(json.dumps({"valid": False, "decryptedUid": uid, "counterValue": counter,
                          "error": "CMAC verification failed"}, indent=2))
        return 1
    if counter <= args.last_counter:
        print(json.dumps({"valid": False, "decryptedUid": uid, "counterValue": counter,
                          "error": "Counter replay detected"}, indent=2))
        return 1
    print(json.dumps({"valid": True, "decryptedUid": uid, "counterValue": counter}, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="tag-encoder", description="NTAG 424 DNA encoder (SIM-ONLY Phase 1)")
    sub = p.add_subparsers(dest="command", required=True)

    enc = sub.add_parser("encode", help="encode a SUN payload for an item")
    enc.add_argument("--item", required=True, help="item id (token name + UID seed)")
    enc.add_argument("--uid", help="explicit 7-byte UID hex (14 chars); else derived from item")
    enc.add_argument("--counter", type=int, default=0, help="read counter (0..16777215)")
    enc.add_argument("--token", help="SUN token name (defaults to --item)")
    enc.add_argument("--base-url", default=DEFAULT_BASE_URL, help="SUN base URL")
    enc.add_argument("--dry-run", action="store_true", help="print APDU sequence + SUN, write nothing")
    enc.set_defaults(func=cmd_encode)

    rd = sub.add_parser("read", help="parse an NDEF file image back to its URI")
    rd.add_argument("--ndef", required=True, help="NDEF file image hex (NLEN || message)")
    rd.set_defaults(func=cmd_read)

    vf = sub.add_parser("verify", help="verify a SUN PICC+CMAC against backend logic")
    vf.add_argument("--uid", help="expected 7-byte UID hex (optional)")
    vf.add_argument("--key", required=True, help="per-tag AES-128 key hex (32 chars)")
    vf.add_argument("--picc", required=True, help="encrypted PICCData hex (32 chars)")
    vf.add_argument("--cmac", required=True, help="truncated CMAC hex (16 chars)")
    vf.add_argument("--last-counter", type=int, default=-1, help="last seen counter (replay gate)")
    vf.set_defaults(func=cmd_verify)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
