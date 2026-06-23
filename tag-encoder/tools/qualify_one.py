"""S-NFC2 single-tag qualifier — reads ONE freshly-seated tag, appends to manifest.

UNAUTHENTICATED, READ-ONLY (GetVersion + GetTTStatus). Writes nothing to the tag.
Waits for a NEW card insertion (remove any present tag, then seat the next one).
Run once per tag:  /tmp/nfc-venv/bin/python tag-encoder/tools/qualify_one.py
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gate_check import (  # noqa: E402
    SELECT_NDEF_APP, GET_VERSION, GET_VERSION_AF, GET_TT_STATUS, classify_tt_status,
)

MANIFEST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "qualification_manifest.json")


def _sw(s1: int, s2: int) -> int:
    return (s1 << 8) | s2


def main() -> int:
    from smartcard.System import readers
    from smartcard.CardRequest import CardRequest
    from smartcard.CardType import AnyCardType
    from smartcard.util import toHexString

    rl = [r for r in readers() if "PICC" in str(r)] or readers()
    if not rl:
        print("NO READER."); return 2
    reader = rl[0]
    print("Seat the next tag now (waiting up to 60s for a fresh insertion)...")
    try:
        svc = CardRequest(timeout=60, readers=[reader], cardType=AnyCardType(),
                          newcardonly=True).waitforcard()
    except Exception as e:
        print(f"No fresh tag seen: {e}"); return 2
    conn = svc.connection
    conn.connect()

    rec: dict = {}
    conn.transmit(SELECT_NDEF_APP)
    d1, *_ = conn.transmit(GET_VERSION)
    rec["sub_type"] = f"0x{d1[2]:02X}" if len(d1) >= 7 else None
    conn.transmit(GET_VERSION_AF)
    d3, *_ = conn.transmit(GET_VERSION_AF)
    rec["uid"] = toHexString(d3[:7]).replace(" ", "") if len(d3) >= 7 else None
    td, ts1, ts2 = conn.transmit(GET_TT_STATUS)
    sw = _sw(ts1, ts2)
    rec["tt_sw"] = f"{sw:04X}"
    rec["verdict"], rec["explanation"] = classify_tt_status(sw, td)

    # load / append / dedupe-by-uid
    data = {"tool": "S-NFC2 qualify_one", "reader": str(reader), "tags": []}
    if os.path.exists(MANIFEST):
        try:
            data = json.load(open(MANIFEST))
        except Exception:
            pass
    tags = [t for t in data.get("tags", []) if t.get("uid") != rec["uid"]]
    rec["seq"] = len(tags) + 1
    tags.append(rec)
    plain = sum(1 for t in tags if t.get("verdict") == "PLAIN")
    data.update({
        "tags": tags,
        "tags_qualified": len(tags),
        "plain": plain,
        "all_plain": plain == len(tags) and len(tags) > 0,
    })
    json.dump(data, open(MANIFEST, "w"), indent=2)

    mark = "OK " if rec["verdict"] == "PLAIN" else "!! "
    print(f"{mark}#{rec['seq']}  UID={rec['uid']}  sub_type={rec['sub_type']}  "
          f"TT_SW={rec['tt_sw']}  -> {rec['verdict']}")
    print(f"manifest total: {plain}/{len(tags)} PLAIN")
    return 0 if rec["verdict"] == "PLAIN" else 1


if __name__ == "__main__":
    raise SystemExit(main())
