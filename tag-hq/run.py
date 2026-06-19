#!/usr/bin/env python3
"""Launch Tag HQ. Read-only NTAG 424 DNA diagnostic console (S-NFC1).

    python run.py            # serve dashboard on http://127.0.0.1:8728
    python run.py --port 9000

The server runs the AN12196 Table 30 originality self-test at startup and
refuses to serve if it fails. Loopback-only; never binds externally.
"""

import argparse

from tag_hq.server import run

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Tag HQ — read-only NTAG 424 DNA diagnostic console")
    ap.add_argument("--port", type=int, default=8728)
    ap.add_argument("--host", default="127.0.0.1", help="loopback only (127.0.0.1/localhost/::1)")
    args = ap.parse_args()
    print(f"\n  TAG HQ → http://{args.host}:{args.port}\n  (read-only · loopback · Ctrl-C to stop)\n")
    run(host=args.host, port=args.port)
