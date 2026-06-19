"""FastAPI server shell for Tag HQ. Bound to 127.0.0.1 only (see run()).

Hard startup gate: if the AN12196 Table 30 originality self-test does not pass,
the app refuses to serve — no field read can be trusted with broken crypto wiring.

Read-only end to end: the only writes are to the local SQLite catalog.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.requests import Request

from . import __version__, genuineness
from .catalog import Catalog
from .diagnostic import run_full_diagnostic
from .transport import NoCardError, NoReaderError, Transport, WriteBlockedError, list_readers

log = logging.getLogger("tag_hq")

_HERE = Path(__file__).resolve().parent
_TEMPLATES = Jinja2Templates(directory=str(_HERE / "dashboard" / "templates"))


def create_app(catalog: Catalog | None = None) -> FastAPI:
    # --- gating self-test BEFORE the app can serve ---
    st = genuineness.run_selftest()
    if not st.genuine:
        raise RuntimeError(
            f"ABORT: originality self-test FAILED ({st.reason}). "
            "Crypto wiring is broken; refusing to start."
        )
    log.info("originality self-test PASSED (AN12196 Table 30, UID %s)", st.uid_hex)

    app = FastAPI(title="Tag HQ", version=__version__)
    cat = catalog or Catalog()
    app.state.catalog = cat
    app.mount("/static", StaticFiles(directory=str(_HERE / "dashboard" / "static")), name="static")

    @app.get("/", response_class=HTMLResponse)
    def index(request: Request):
        return _TEMPLATES.TemplateResponse(
            request, "index.html",
            {"version": __version__, "selftest_uid": genuineness.SELFTEST_UID.hex().upper()},
        )

    @app.get("/api/health")
    def health():
        return {"ok": True, "version": __version__, "selftest": st.genuine,
                "selftest_label": st.label}

    @app.get("/api/readers")
    def readers():
        names = list_readers()
        return {"readers": names, "present": bool(names)}

    @app.post("/api/scan")
    def scan():
        """Run a full read-only diagnostic on the tag currently on the antenna."""
        try:
            with Transport.connect() as tx:
                snapshot = run_full_diagnostic(tx)
        except NoReaderError as exc:
            raise HTTPException(status_code=409, detail={"kind": "no_reader", "message": str(exc)})
        except NoCardError as exc:
            raise HTTPException(status_code=409, detail={"kind": "no_card", "message": str(exc)})
        except WriteBlockedError as exc:  # pragma: no cover - guard should never trip in read flow
            raise HTTPException(status_code=500, detail={"kind": "write_blocked", "message": str(exc)})
        scan_id = cat.record(snapshot)
        snapshot["scan_id"] = scan_id
        return snapshot

    @app.get("/api/catalog")
    def catalog_list(limit: int = 100):
        rows = cat.recent(limit)
        return {
            "stats": cat.stats(),
            "rows": [
                {"id": r.id, "uid_hex": r.uid_hex, "scanned_at": r.scanned_at,
                 "fit": r.fit, "genuine": r.genuine, "variant": r.variant,
                 "headline": r.headline}
                for r in rows
            ],
        }

    @app.get("/api/scan/{scan_id}")
    def scan_detail(scan_id: int):
        row = cat.get(scan_id)
        if not row:
            raise HTTPException(status_code=404, detail="scan not found")
        return {"id": row.id, "scanned_at": row.scanned_at, "diagnostic": row.diagnostic}

    @app.get("/api/selftest")
    def selftest():
        r = genuineness.run_selftest()
        return {"genuine": r.genuine, "label": r.label, "reason": r.reason, "uid": r.uid_hex}

    return app


def run(host: str = "127.0.0.1", port: int = 8728) -> None:
    """Launch the dashboard. Host is pinned to loopback — never bind externally."""
    import uvicorn

    if host not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError(f"Tag HQ binds to loopback only; refusing host {host!r}")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    uvicorn.run(create_app(), host=host, port=port)


if __name__ == "__main__":  # pragma: no cover
    run()
