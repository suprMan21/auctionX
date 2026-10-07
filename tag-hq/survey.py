#!/usr/bin/env python3
"""Chip survey — read-only UID + physical fingerprint census of a chip batch (S-NFC-ID).

    python survey.py                       # interactive: one chip at a time, you label each
    python survey.py --out ~/batch-a.csv
    python survey.py --label S03           # one chip, no prompts (e.g. driven from Claude)

For each chip: place it ALONE on the reader, press Enter, type the label you
wrote on it. The full Tag HQ diagnostic runs through the read-only transport
whitelist (nothing can be written), then one CSV row is appended:

    label, uid, fingerprint (SHA-256 of the raw Read_Sig bytes — the same value
    the encoder sends at precheck/enroll), NXP originality, key versions K0..K4,
    key state (factory / v1 / v2 / mixed), SDM on, our serial (sn=) if encoded.

A repeated UID is flagged as it happens; a repeated fingerprint means the same
physical chip was scanned twice. Note: reading an SDM-enabled chip's NDEF file
advances its SUN counter by one, exactly as a phone tap does. Harmless.

The CSV holds raw UIDs, so it is written outside the repo (default
~/.am-tag-hq/) with 0600 permissions. Do not commit it.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from tag_hq.diagnostic import run_full_diagnostic
from tag_hq.transport import NoCardError, NoReaderError, Transport

FIELDS = [
    "scanned_at", "label", "uid", "fingerprint", "genuine", "key_versions", "key_state",
    "sdm_enabled", "serial", "token", "variant", "errors",
]


def key_state(versions: dict[str, int | None]) -> str:
    vals = [v for v in versions.values() if v is not None]
    if not vals:
        return "unknown"
    if all(v == 0 for v in vals):
        return "factory"
    if len(set(vals)) == 1:
        return f"v{vals[0]}"
    return "mixed"


def row_from_snapshot(snap: dict, label: str) -> dict:
    """Pure: one diagnostic snapshot -> one survey row (unit-tested without a reader)."""
    sig_hex = snap.get("signature_hex")
    fingerprint = hashlib.sha256(bytes.fromhex(sig_hex)).hexdigest() if sig_hex else ""
    versions = (snap.get("key_config") or {}).get("versions") or {}
    ndef = ((snap.get("file_structure") or {}).get("ndef")) or {}
    uri = ndef.get("uri") or ""
    query = parse_qs(urlparse(uri).query) if uri else {}
    path = urlparse(uri).path if uri else ""
    token = path.rsplit("/verify/", 1)[1] if "/verify/" in path else ""
    sdm = snap.get("sdm_sun") or {}
    return {
        "scanned_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "label": label,
        "uid": snap.get("uid_hex") or "",
        "fingerprint": fingerprint,
        "genuine": snap.get("genuine"),
        "key_versions": " ".join(f"K{k[-1]}={v}" for k, v in sorted(versions.items())),
        "key_state": key_state(versions),
        "sdm_enabled": bool(sdm.get("enabled", sdm.get("sdm_enabled", False))),
        "serial": (query.get("sn") or [""])[0],
        "token": token,
        "variant": snap.get("variant") or "",
        "errors": "; ".join(snap.get("errors") or []),
    }


def _report(row: dict, seen_uid: dict[str, list[str]], seen_fp: dict[str, str]) -> None:
    uid, fp, label = row["uid"], row["fingerprint"], row["label"]
    print(f"  {label}: UID {uid}  fp {fp[:12]}  genuine={row['genuine']}  "
          f"keys={row['key_state']}  serial={row['serial'] or '—'}  token={row['token'] or '—'}")
    if row["errors"]:
        print(f"  ! read errors: {row['errors']}")
    if fp and fp in seen_fp:
        print(f"  ↺ same physical chip as '{seen_fp[fp]}' (identical fingerprint)")
        return
    if uid in seen_uid:
        print(f"  ⚠ UID shared with: {', '.join(seen_uid[uid])}")
    seen_uid.setdefault(uid, []).append(label)
    if fp:
        seen_fp[fp] = label


def _open_out(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    new = not path.exists()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    fh = os.fdopen(fd, "a", newline="")
    writer = csv.DictWriter(fh, fieldnames=FIELDS)
    if new:
        writer.writeheader()
    return fh, writer


def main() -> int:
    default = Path.home() / ".am-tag-hq" / f"survey-{datetime.now():%Y%m%d}.csv"
    ap = argparse.ArgumentParser(description="Read-only chip survey (UID + fingerprint census)")
    ap.add_argument("--out", type=Path, default=default, help=f"CSV path (default {default})")
    ap.add_argument("--reader", help="substring of the PC/SC reader name")
    ap.add_argument("--label", help="scan ONE chip with this label, no prompts, then exit")
    args = ap.parse_args()

    # Earlier rows in the same file count, so a one-chip run still flags repeats.
    seen_uid: dict[str, list[str]] = {}
    seen_fp: dict[str, str] = {}
    if args.out.exists():
        with open(args.out, newline="") as prev:
            for r in csv.DictReader(prev):
                if r["fingerprint"] and r["fingerprint"] in seen_fp:
                    continue
                seen_uid.setdefault(r["uid"], []).append(r["label"])
                if r["fingerprint"]:
                    seen_fp[r["fingerprint"]] = r["label"]

    fh, writer = _open_out(args.out)
    if args.label is not None:
        try:
            with Transport.connect(args.reader) as tx:
                snap = run_full_diagnostic(tx)
        except (NoReaderError, NoCardError) as exc:
            fh.close()
            print(f"  ✗ {exc}")
            return 1
        row = row_from_snapshot(snap, args.label)
        writer.writerow(row)
        fh.close()
        _report(row, seen_uid, seen_fp)
        return 0
    print(f"\n  CHIP SURVEY (read-only) → {args.out}\n  One chip on the reader at a time. Enter = scan, q = finish.\n")
    n = 0
    try:
        while True:
            if input(f"[{n + 1}] Place a chip, then Enter (q to finish): ").strip().lower() == "q":
                break
            try:
                with Transport.connect(args.reader) as tx:
                    snap = run_full_diagnostic(tx)
            except (NoReaderError, NoCardError) as exc:
                print(f"  ✗ {exc}")
                continue
            label = input("  Label written on this chip: ").strip() or f"unlabelled-{n + 1}"
            row = row_from_snapshot(snap, label)
            writer.writerow(row)
            fh.flush()
            n += 1

            _report(row, seen_uid, seen_fp)
    finally:
        fh.close()

    dupes = {u: ls for u, ls in seen_uid.items() if len(ls) > 1}
    print(f"\n  {n} scans, {len(seen_fp)} distinct chips, {len(seen_uid)} distinct UIDs → {args.out}")
    for uid, labels in dupes.items():
        print(f"  ⚠ UID {uid} on {len(labels)} chips: {', '.join(labels)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
