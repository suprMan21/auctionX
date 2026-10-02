"""PC/SC transport for the encoder — S-NFC2 Phase 2.

Separate from tag-hq's transport on purpose: tag-hq's whitelist is read-only
and must stay that way. This one sends write APDUs, so it is only ever used by
the personalisation flow (personalise.py), which gates every chip first.

pyscard is imported lazily so the package imports on a machine with no PC/SC
stack or no reader attached (tests use the emulator instead).
"""

from __future__ import annotations

from typing import Protocol

SW_ISO_OK = 0x9000
SW_NATIVE_OK = 0x9100
SW_ADDITIONAL_FRAME = 0x91AF


class TransportError(RuntimeError):
    pass


class CardIO(Protocol):
    """One APDU in, (response data, 16-bit status word) out."""

    def transmit(self, apdu: list[int]) -> tuple[bytes, int]: ...


def _is_picc_reader(name: str) -> bool:
    """ACS readers expose a 'PICC' (contactless) interface; prefer it over 'SAM'/'ICC'."""
    n = name.upper()
    return "PICC" in n or ("ACR1252" in n and "SAM" not in n)


class PcscCard:
    """A connected PC/SC session to the tag on the reader. Use as a context manager."""

    def __init__(self, reader_name: str, connection) -> None:
        self.reader_name = reader_name
        self._conn = connection

    @classmethod
    def connect(cls, prefer: str | None = None) -> "PcscCard":
        try:
            from smartcard.System import readers as _readers
        except Exception as exc:  # pragma: no cover - import guard
            raise TransportError(f"PC/SC stack unavailable (pip install pyscard): {exc}") from exc

        rdrs = _readers()
        if not rdrs:
            raise TransportError("no PC/SC readers found (is the ACR1252U plugged in?)")
        ordered = sorted(rdrs, key=lambda r: (0 if _is_picc_reader(str(r)) else 1, str(r)))
        if prefer:
            ordered = [r for r in ordered if prefer in str(r)] or ordered

        last_err: Exception | None = None
        for r in ordered:
            try:
                conn = r.createConnection()
                conn.connect()
                return cls(str(r), conn)
            except Exception as exc:  # NoCardException, CardConnectionException, ...
                last_err = exc
        raise TransportError(f"reader present but no tag on the antenna ({last_err})")

    def close(self) -> None:
        try:
            self._conn.disconnect()
        except Exception:
            pass

    def __enter__(self) -> "PcscCard":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def transmit(self, apdu: list[int]) -> tuple[bytes, int]:
        data, sw1, sw2 = self._conn.transmit(list(apdu))
        return bytes(data), (sw1 << 8) | sw2
