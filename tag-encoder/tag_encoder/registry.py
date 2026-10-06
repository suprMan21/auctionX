"""Tag registry client — the backend's nfc_tags, as the encoder sees it.

Two calls, both staff-only on the backend:
    GET  /api/v1/nfc/enroll/precheck/:tagUid?serial=&sigSha256=
         -> { exists, lifecycleStatus, uidMatches }
    POST /api/v1/nfc/enroll  { tagUid, itemId?, chipSerial?, sigSha256?, sdmKeyVersion? }
         -> { tagId, lifecycleStatus: ENROLLED }

S-NFC-ID: with a serial + signature fingerprint, `exists` means THIS physical
chip (same fingerprint) or this serial is already registered. A UID shared
with another chip is reported in `uidMatches` but is not a refusal.

precheck runs BEFORE any write to the chip (a RETIRED UID is never re-personalised,
Locked 2026-10-02); enroll runs only AFTER the read-back verified. No key
material ever crosses this API: the backend derives the chip keys itself.

stdlib only (urllib) so the encoder keeps zero runtime dependencies.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Protocol

DEFAULT_API_BASE = "https://vw7zy9mkyg.us-east-2.awsapprunner.com"
_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


class RegistryError(RuntimeError):
    pass


@dataclass(frozen=True)
class Precheck:
    exists: bool
    lifecycle_status: str | None
    uid_matches: int = 0


class Registry(Protocol):
    def precheck(self, uid_hex: str, serial_hex: str | None = None, sig_sha256: str | None = None) -> Precheck: ...

    def enroll(
        self,
        uid_hex: str,
        item_id: str | None,
        serial_hex: str | None = None,
        sig_sha256: str | None = None,
        key_version: int | None = None,
    ) -> str:
        """Returns the new nfc_tags.id."""
        ...


def item_uuid_or_none(item: str) -> str | None:
    """enroll's itemId must be an items.id UUID; a free-text item label is not sent."""
    return item if _UUID.match(item) else None


class BackendRegistry:
    def __init__(self, api_base: str, staff_jwt: str, timeout: float = 15.0) -> None:
        self.api_base = api_base.rstrip("/")
        self._jwt = staff_jwt
        self.timeout = timeout

    def __repr__(self) -> str:
        return f"BackendRegistry({self.api_base!r}, <jwt redacted>)"

    def _call(self, method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            self.api_base + path,
            data=data,
            method=method,
            headers={"Authorization": f"Bearer {self._jwt}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return resp.status, json.loads(resp.read() or b"{}")
        except urllib.error.HTTPError as exc:
            try:
                payload = json.loads(exc.read() or b"{}")
            except ValueError:
                payload = {}
            return exc.code, payload
        except (urllib.error.URLError, TimeoutError) as exc:
            raise RegistryError(f"backend unreachable: {exc}") from exc

    def precheck(self, uid_hex: str, serial_hex: str | None = None, sig_sha256: str | None = None) -> Precheck:
        query = {k: v for k, v in (("serial", serial_hex), ("sigSha256", sig_sha256)) if v}
        qs = f"?{urllib.parse.urlencode(query)}" if query else ""
        status, payload = self._call("GET", f"/api/v1/nfc/enroll/precheck/{uid_hex}{qs}")
        if status != 200 or not payload.get("success"):
            # Fail closed: anything but a definite answer stops the encode.
            raise RegistryError(f"precheck failed (HTTP {status}): {payload.get('error', 'no detail')}")
        data = payload["data"]
        return Precheck(bool(data["exists"]), data.get("lifecycleStatus"), int(data.get("uidMatches") or 0))

    def enroll(
        self,
        uid_hex: str,
        item_id: str | None,
        serial_hex: str | None = None,
        sig_sha256: str | None = None,
        key_version: int | None = None,
    ) -> str:
        body: dict = {"tagUid": uid_hex}
        if item_id:
            body["itemId"] = item_id
        if serial_hex:
            body["chipSerial"] = serial_hex
        if sig_sha256:
            body["sigSha256"] = sig_sha256
        if key_version is not None:
            body["sdmKeyVersion"] = key_version
        status, payload = self._call("POST", "/api/v1/nfc/enroll", body)
        if status != 201 or not payload.get("success"):
            raise RegistryError(f"enroll failed (HTTP {status}): {payload.get('error', 'no detail')}")
        return payload["data"]["tagId"]


def login_staff(supabase_url: str, anon_key: str, email: str, password: str, timeout: float = 15.0) -> str:
    """Supabase GoTrue password grant -> access token (JWT). Nothing is persisted."""
    req = urllib.request.Request(
        supabase_url.rstrip("/") + "/auth/v1/token?grant_type=password",
        data=json.dumps({"email": email, "password": password}).encode(),
        method="POST",
        headers={"apikey": anon_key, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())["access_token"]
    except urllib.error.HTTPError as exc:
        raise RegistryError(f"staff login failed (HTTP {exc.code})") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RegistryError(f"Supabase unreachable: {exc}") from exc


def backend_registry_from_env() -> BackendRegistry:
    """AM_STAFF_JWT, or SUPABASE_URL + SUPABASE_ANON_KEY + AM_STAFF_EMAIL + AM_STAFF_PASSWORD."""
    api = os.environ.get("AM_API_BASE", DEFAULT_API_BASE)
    jwt = os.environ.get("AM_STAFF_JWT")
    if not jwt:
        need = ("SUPABASE_URL", "SUPABASE_ANON_KEY", "AM_STAFF_EMAIL", "AM_STAFF_PASSWORD")
        missing = [k for k in need if not os.environ.get(k)]
        if missing:
            raise RegistryError("set AM_STAFF_JWT, or " + " + ".join(need) + f" (missing: {', '.join(missing)})")
        jwt = login_staff(*(os.environ[k] for k in need))
    return BackendRegistry(api, jwt)


@dataclass
class MemoryRegistry:
    """In-process registry for the emulator and tests."""

    rows: dict[str, str] = field(default_factory=dict)  # v1 rows: uid -> lifecycle status
    chips: list[dict] = field(default_factory=list)  # v2 rows: {uid, serial, sig, status}
    fail_enroll: bool = False

    def precheck(self, uid_hex: str, serial_hex: str | None = None, sig_sha256: str | None = None) -> Precheck:
        uid = uid_hex.upper()
        if serial_hex is None:  # v1: the UID is the identity
            status = self.rows.get(uid)
            return Precheck(status is not None, status)
        hit = next(
            (c for c in self.chips if (sig_sha256 and c["sig"] == sig_sha256) or (serial_hex and c["serial"] == serial_hex)),
            None,
        )
        same_uid = sum(1 for c in self.chips if c["uid"] == uid) + (1 if uid in self.rows else 0)
        return Precheck(hit is not None, hit["status"] if hit else None, same_uid)

    def enroll(
        self,
        uid_hex: str,
        item_id: str | None,
        serial_hex: str | None = None,
        sig_sha256: str | None = None,
        key_version: int | None = None,
    ) -> str:
        if self.fail_enroll:
            raise RegistryError("enroll failed (simulated)")
        uid = uid_hex.upper()
        if serial_hex is None:
            if uid in self.rows:
                raise RegistryError("enroll failed (HTTP 409): UID already exists")
            self.rows[uid] = "ENROLLED"
        else:
            if any(c["serial"] == serial_hex or (sig_sha256 and c["sig"] == sig_sha256) for c in self.chips):
                raise RegistryError("enroll failed (HTTP 409): chip already exists")
            self.chips.append({"uid": uid, "serial": serial_hex, "sig": sig_sha256, "status": "ENROLLED"})
        return f"00000000-0000-4000-8000-{len(self.rows) + len(self.chips):012d}"
