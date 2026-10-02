"""Encoder audit ledger — append-only JSON lines on the encoding station.

One record per encode attempt: who, when, which item, which tag (nfc_tags.id),
outcome, key version, read-back counter. Per the logging rules (Lessons DB:
enums, ids, numbers and booleans only) it NEVER holds the UID, the SUN URL,
PICCData, a CMAC or any key material; the tag id resolves to the UID in the
registry for anyone entitled to see it. The backend's own `nfc.enroll`
security event is the server-side record.
"""

from __future__ import annotations

import getpass
import json
import os
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_AUDIT_PATH = Path.home() / ".am-tag-encoder" / "audit.jsonl"

_ALLOWED = frozenset({
    "ts", "event", "operator", "result", "reason", "stage", "item", "token", "tag_id",
    "key_version", "readback_counter", "resumed", "mode", "encoder_version",
})


def operator_identity() -> str:
    return os.environ.get("AM_TAG_ENCODER_PRINCIPAL") or getpass.getuser()


class AuditLog:
    def __init__(self, path: Path | str | None = DEFAULT_AUDIT_PATH) -> None:
        self.path = Path(path) if path else None
        self.records: list[dict] = []

    def write(self, **fields) -> dict:
        unknown = set(fields) - _ALLOWED
        if unknown:  # redaction control: a new field must be added on purpose
            raise ValueError(f"audit fields not allowed: {sorted(unknown)}")
        record = {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"), **fields}
        self.records.append(record)
        if self.path:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            fd = os.open(self.path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
            with os.fdopen(fd, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(record, sort_keys=True) + "\n")
        return record
