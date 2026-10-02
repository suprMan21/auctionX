"""Tag registry client — the backend's nfc_tags, as the encoder sees it.

Two calls, both staff-only on the backend:
    GET  /api/v1/nfc/enroll/precheck/:tagUid -> { exists, lifecycleStatus }
    POST /api/v1/nfc/enroll  { tagUid, itemId? } -> { tagId, lifecycleStatus: ENROLLED }

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


class Registry(Protocol):
    def precheck(self, uid_hex: str) -> Precheck: ...

    def enroll(self, uid_hex: str, item_id: str | None) -> str:
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

    def precheck(self, uid_hex: str) -> Precheck:
        status, payload = self._call("GET", f"/api/v1/nfc/enroll/precheck/{uid_hex}")
        if status != 200 or not payload.get("success"):
            # Fail closed: anything but a definite answer stops the encode.
            raise RegistryError(f"precheck failed (HTTP {status}): {payload.get('error', 'no detail')}")
        data = payload["data"]
        return Precheck(bool(data["exists"]), data.get("lifecycleStatus"))

    def enroll(self, uid_hex: str, item_id: str | None) -> str:
        body: dict = {"tagUid": uid_hex}
        if item_id:
            body["itemId"] = item_id
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

    rows: dict[str, str] = field(default_factory=dict)  # uid -> lifecycle status
    fail_enroll: bool = False

    def precheck(self, uid_hex: str) -> Precheck:
        status = self.rows.get(uid_hex.upper())
        return Precheck(status is not None, status)

    def enroll(self, uid_hex: str, item_id: str | None) -> str:
        if self.fail_enroll:
            raise RegistryError("enroll failed (simulated)")
        uid = uid_hex.upper()
        if uid in self.rows:
            raise RegistryError("enroll failed (HTTP 409): UID already exists")
        self.rows[uid] = "ENROLLED"
        return f"00000000-0000-4000-8000-{len(self.rows):012d}"
