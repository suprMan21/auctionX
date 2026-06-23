"""S-NFC2 batch lot-qualifier — tap each sample tag; records UID + plain/Tx verdict.

UNAUTHENTICATED, READ-ONLY (GetVersion + GetTTStatus only). Writes nothing.

Flow: present a tag -> it's qualified -> remove it -> present the next. Ends when
no new tag appears within the idle timeout (so just stop tapping when done).
Writes a manifest to tag-encoder/tools/qualification_manifest.json.

Run:  /tmp/nfc-venv/bin/python tag-encoder/tools/batch_qualify.py
"""
from __future__ import annotations

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gate_check import (  # noqa: E402
    SELECT_NDEF_APP, GET_VERSION, GET_VERSION_AF, GET_TT_STATUS, classify_tt_status,
)

MANIFEST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "qualification_manifest.json")
MAX_TAGS = 12
IDLE_TIMEOUT = 40   # seconds to wait for the next tag before ending the sweep


def _sw(s1: int, s2: int) -> int:
    return (s1 << 8) | s2


def qualify(conn) -> dict:
    from smartcard.util import toHexString
    rec: dict = {}
    conn.transmit(SELECT_NDEF_APP)
    d1, s11, s12 = conn.transmit(GET_VERSION)          # HW info
    rec["sub_type"] = f"0x{d1[2]:02X}" if len(d1) >= 7 else None
    rec["hw_ok"] = len(d1) >= 7 and d1[0] == 0x04 and d1[1] == 0x04 and d1[5] == 0x11
    conn.transmit(GET_VERSION_AF)                       # SW info (drain)
    d3, *_ = conn.transmit(GET_VERSION_AF)             # production info -> UID
    rec["uid"] = toHexString(d3[:7]).replace(" ", "") if len(d3) >= 7 else None
    td, ts1, ts2 = conn.transmit(GET_TT_STATUS)
    sw = _sw(ts1, ts2)
    rec["tt_sw"] = f"{sw:04X}"
    verdict, why = classify_tt_status(sw, td)
    rec["verdict"] = verdict
    rec["explanation"] = why
    return rec


def wait_removal(reader, timeout=30) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            c = reader.createConnection(); c.connect(); c.disconnect()
            time.sleep(0.4)
        except Exception:
            return  # card gone


def main() -> int:
    from smartcard.System import readers
    from smartcard.CardRequest import CardRequest
    from smartcard.CardType import AnyCardType

    rl = [r for r in readers() if "PICC" in str(r)] or readers()
    if not rl:
        print("NO READER."); return 2
    reader = rl[0]
    print(f"Reader: {reader}\nTap each sample tag in turn. Stop tapping when done "
          f"(sweep ends after {IDLE_TIMEOUT}s idle).\n")

    results: list[dict] = []
    for i in range(1, MAX_TAGS + 1):
        try:
            svc = CardRequest(timeout=IDLE_TIMEOUT, readers=[reader],
                              cardType=AnyCardType()).waitforcard()
        except Exception:
            print(f"\nNo further tag within {IDLE_TIMEOUT}s — ending sweep.")
            break
        conn = svc.connection
        conn.connect()
        try:
            rec = qualify(conn)
        except Exception as e:
            rec = {"uid": None, "verdict": "ERROR", "explanation": str(e)}
        rec["seq"] = i
        results.append(rec)
        mark = "OK " if rec.get("verdict") == "PLAIN" else "!! "
        print(f"  {mark}#{i:>2}  UID={rec.get('uid')}  sub_type={rec.get('sub_type')}  "
              f"TT_SW={rec.get('tt_sw')}  -> {rec.get('verdict')}")
        wait_removal(reader)

    # dedupe by UID (in case a tag was tapped twice), keep first
    seen, deduped = set(), []
    for r in results:
        if r.get("uid") and r["uid"] in seen:
            continue
        seen.add(r.get("uid")); deduped.append(r)

    plain = sum(1 for r in deduped if r.get("verdict") == "PLAIN")
    summary = {
        "tool": "S-NFC2 batch_qualify",
        "reader": str(reader),
        "tags_qualified": len(deduped),
        "plain": plain,
        "not_plain": len(deduped) - plain,
        "all_plain": plain == len(deduped) and len(deduped) > 0,
        "tags": deduped,
    }
    with open(MANIFEST, "w") as f:
        json.dump(summary, f, indent=2)

    print("\n" + "=" * 64)
    print(f"BATCH RESULT: {plain}/{len(deduped)} PLAIN  "
          f"({'ALL PLAIN — gate clears for the lot' if summary['all_plain'] else 'REVIEW non-plain tags'})")
    print(f"Manifest: {MANIFEST}")
    print("=" * 64)
    return 0 if summary["all_plain"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
