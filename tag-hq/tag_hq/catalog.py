"""Local SQLite catalog of scanned tags.

Keyed on the 7-byte UID hex string — the chip's stable identity — NOT a synthetic
UUID (Lessons Learned 31c3…f27f: verification surfaces carry tag_uid strings, so
the UID hex is the natural join key). Stores diagnostic summaries + verdicts only.
NEVER stores key material (only key VERSION bytes ever leave the chip via
GetKeyVersion, and we persist those as small integers).

Read-only w.r.t. the chip; this is the one component that writes — to local disk.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path

DEFAULT_DB = Path(__file__).resolve().parent.parent / "tag_hq.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS scans (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    uid_hex      TEXT NOT NULL,
    scanned_at   TEXT NOT NULL DEFAULT (datetime('now')),
    fit          INTEGER NOT NULL,
    genuine      INTEGER NOT NULL,
    variant      TEXT,
    headline     TEXT,
    diagnostic   TEXT NOT NULL          -- full JSON snapshot
);
CREATE INDEX IF NOT EXISTS idx_scans_uid ON scans(uid_hex);
CREATE INDEX IF NOT EXISTS idx_scans_time ON scans(scanned_at);
"""


@dataclass(frozen=True)
class CatalogRow:
    id: int
    uid_hex: str
    scanned_at: str
    fit: bool
    genuine: bool
    variant: str | None
    headline: str | None
    diagnostic: dict


class Catalog:
    def __init__(self, db_path: Path | str = DEFAULT_DB) -> None:
        self.db_path = Path(db_path)
        self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    def record(self, diagnostic: dict) -> int:
        """Persist one diagnostic snapshot. Returns the new row id."""
        uid_hex = diagnostic.get("uid_hex") or "UNKNOWN"
        verdict = diagnostic.get("verdict", {})
        cur = self._conn.execute(
            "INSERT INTO scans (uid_hex, fit, genuine, variant, headline, diagnostic) "
            "VALUES (?,?,?,?,?,?)",
            (
                uid_hex,
                1 if verdict.get("fit") else 0,
                1 if diagnostic.get("genuine") else 0,
                diagnostic.get("variant"),
                verdict.get("headline"),
                json.dumps(diagnostic),
            ),
        )
        self._conn.commit()
        return int(cur.lastrowid)

    def _row(self, r: sqlite3.Row) -> CatalogRow:
        return CatalogRow(
            id=r["id"], uid_hex=r["uid_hex"], scanned_at=r["scanned_at"],
            fit=bool(r["fit"]), genuine=bool(r["genuine"]), variant=r["variant"],
            headline=r["headline"], diagnostic=json.loads(r["diagnostic"]),
        )

    def recent(self, limit: int = 100) -> list[CatalogRow]:
        rows = self._conn.execute(
            "SELECT * FROM scans ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        return [self._row(r) for r in rows]

    def get(self, scan_id: int) -> CatalogRow | None:
        r = self._conn.execute("SELECT * FROM scans WHERE id=?", (scan_id,)).fetchone()
        return self._row(r) if r else None

    def history_for_uid(self, uid_hex: str) -> list[CatalogRow]:
        rows = self._conn.execute(
            "SELECT * FROM scans WHERE uid_hex=? ORDER BY id DESC", (uid_hex.upper(),)
        ).fetchall()
        return [self._row(r) for r in rows]

    def stats(self) -> dict:
        row = self._conn.execute(
            "SELECT COUNT(*) total, "
            "COALESCE(SUM(fit),0) fit, "
            "COUNT(DISTINCT uid_hex) distinct_tags "
            "FROM scans"
        ).fetchone()
        return {"total": row["total"], "fit": row["fit"],
                "not_fit": row["total"] - row["fit"], "distinct_tags": row["distinct_tags"]}
