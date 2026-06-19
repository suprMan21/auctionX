"""PC-SC transport for the ACR1252U — with a hard READ-ONLY command whitelist.

Every APDU passes through `Transport.transmit()`, which rejects any (CLA, INS)
not in `apdu.ALLOWED` BEFORE it reaches the card. This is the enforcement point
for the S-NFC1 hard line: zero write/encode APDUs can ever be sent, even by a
buggy caller. The whitelist is derived from the read-only opcode table in
apdu.py, so the two cannot drift.

pyscard is imported lazily so the module (and the gating self-test, parsers,
verdict logic, and dashboard) import cleanly on a machine with no PC-SC stack
or no reader attached.
"""

from __future__ import annotations

from dataclasses import dataclass

from . import apdu

# Status words we treat as success for NTAG 424 DNA / ISO.
SW_ISO_OK = (0x90, 0x00)
SW_NATIVE_OK = (0x91, 0x00)
SUCCESS_SW = frozenset({SW_ISO_OK, SW_NATIVE_OK})


class TransportError(RuntimeError):
    """Base for all transport failures."""


class NoReaderError(TransportError):
    """No PC-SC reader (or no ACR1252U PICC interface) is available."""


class NoCardError(TransportError):
    """A reader is present but no tag is on the antenna."""


class WriteBlockedError(TransportError):
    """A non-whitelisted (write/encode/auth) APDU was attempted. Read-only guard."""


@dataclass(frozen=True)
class ApduResponse:
    data: bytes
    sw1: int
    sw2: int

    @property
    def sw(self) -> tuple[int, int]:
        return (self.sw1, self.sw2)

    @property
    def ok(self) -> bool:
        return self.sw in SUCCESS_SW

    @property
    def sw_hex(self) -> str:
        return f"{self.sw1:02X}{self.sw2:02X}"


def _is_picc_reader(name: str) -> bool:
    """ACS readers expose a 'PICC' (contactless) interface; prefer it over 'SAM'/'ICC'."""
    n = name.upper()
    return "PICC" in n or ("ACR1252" in n and "SAM" not in n)


def list_readers() -> list[str]:
    """Return reader names, or [] if the PC-SC stack/readers are unavailable."""
    try:
        from smartcard.System import readers as _readers
    except Exception:  # pragma: no cover - import guard
        return []
    try:
        return [str(r) for r in _readers()]
    except Exception:
        return []


def _assert_read_only(command: list[int]) -> None:
    """Reject any APDU whose (CLA, INS) is not on the read-only whitelist."""
    if len(command) < 2:
        raise WriteBlockedError(f"malformed APDU (too short): {bytes(command).hex().upper()}")
    cla, ins = command[0], command[1]
    if (cla, ins) not in apdu.ALLOWED:
        raise WriteBlockedError(
            f"BLOCKED non-read APDU CLA={cla:02X} INS={ins:02X} — Tag HQ is read-only"
        )


class Transport:
    """A connected PC-SC session to one tag. Use as a context manager."""

    def __init__(self, reader_name: str, connection) -> None:
        self.reader_name = reader_name
        self._conn = connection
        self.atr: bytes = bytes(connection.getATR()) if connection else b""

    # -- lifecycle ---------------------------------------------------------
    @classmethod
    def connect(cls, prefer: str | None = None) -> "Transport":
        """Connect to the first present tag. Raises NoReaderError / NoCardError."""
        try:
            from smartcard.System import readers as _readers
            from smartcard.Exceptions import NoCardException, CardConnectionException
        except Exception as exc:  # pragma: no cover - import guard
            raise NoReaderError(f"PC-SC stack unavailable: {exc}") from exc

        rdrs = _readers()
        if not rdrs:
            raise NoReaderError("no PC-SC readers found (is the ACR1252U plugged in?)")

        # Prefer the contactless PICC interface; honour an explicit name if given.
        ordered = sorted(rdrs, key=lambda r: (0 if _is_picc_reader(str(r)) else 1, str(r)))
        if prefer:
            ordered = [r for r in ordered if prefer in str(r)] or ordered

        last_err: Exception | None = None
        for r in ordered:
            try:
                conn = r.createConnection()
                conn.connect()
                return cls(str(r), conn)
            except (NoCardException, CardConnectionException) as exc:
                last_err = exc
                continue
            except Exception as exc:
                last_err = exc
                continue
        raise NoCardError(f"reader present but no tag on antenna ({last_err})")

    def close(self) -> None:
        try:
            if self._conn:
                self._conn.disconnect()
        except Exception:
            pass

    def __enter__(self) -> "Transport":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    # -- I/O ---------------------------------------------------------------
    def transmit(self, command: list[int]) -> ApduResponse:
        """Send one APDU through the read-only guard and return the response."""
        _assert_read_only(command)
        data, sw1, sw2 = self._conn.transmit(list(command))
        return ApduResponse(bytes(data), sw1, sw2)
