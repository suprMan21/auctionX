"""NDEF URI record BUILDER — the write counterpart to tag-hq's `parse_ndef`.

tag-hq is read-only and only PARSES NDEF; S-NFC2 adds the WRITE side. The
output here is built to round-trip cleanly through `tag_hq.parsers.parse_ndef`:

    file bytes = NLEN(2, big-endian) || NDEF message
    NDEF message = single well-known URI ('U') record:
        header   = 0xD1   (MB=1, ME=1, SR=1, TNF=0x01 well-known)
        type_len = 0x01
        payload_len = 0x01 (prefix byte) + len(uri_remainder)
        type     = 'U'
        payload  = <prefix_code> || uri_remainder_bytes

URI prefix codes match the NFC Forum URI RTD abbreviation table; we use
0x04 = "https://" (the SUN base URL is always https). See AN12196 and the
NFC Forum URI Record Type Definition.
"""

from __future__ import annotations

# NFC Forum URI RTD prefix abbreviations (mirror of tag_hq.parsers._URI_PREFIXES).
URI_PREFIXES: dict[int, str] = {
    0x00: "",
    0x01: "http://www.",
    0x02: "https://www.",
    0x03: "http://",
    0x04: "https://",
    0x05: "tel:",
    0x06: "mailto:",
}
_PREFIX_BY_STR = {v: k for k, v in URI_PREFIXES.items() if v}

# NDEF record header byte for a single, short, well-known record:
# MB(0x80) | ME(0x40) | SR(0x10) | TNF=0x01  -> 0xD1
_NDEF_URI_HEADER = 0xD1


def _split_uri(uri: str) -> tuple[int, bytes]:
    """Return (prefix_code, remainder_bytes), choosing the longest matching prefix."""
    best_code = 0x00
    best_len = -1
    for text, code in _PREFIX_BY_STR.items():
        if uri.startswith(text) and len(text) > best_len:
            best_code, best_len = code, len(text)
    if best_len < 0:
        # No abbreviation matched -> store the whole URI with prefix 0x00.
        return 0x00, uri.encode("utf-8")
    return best_code, uri[best_len:].encode("utf-8")


def build_uri_record(uri: str) -> bytes:
    """Build a single NDEF URI ('U') record (header through payload, no NLEN)."""
    prefix_code, remainder = _split_uri(uri)
    payload = bytes([prefix_code]) + remainder
    payload_len = len(payload)
    if payload_len > 0xFF:
        # Short-record form caps payload at 255 bytes; SUN URLs are well under.
        raise ValueError(f"URI payload {payload_len}B exceeds short-record limit (255B)")
    return bytes([_NDEF_URI_HEADER, 0x01, payload_len]) + b"U" + payload


def build_ndef_uri_file(uri: str) -> bytes:
    """Build the full NDEF file image: NLEN(2B big-endian) || NDEF message.

    This is exactly what `tag_hq.parsers.parse_ndef` expects to read back.
    """
    message = build_uri_record(uri)
    nlen = len(message)
    return nlen.to_bytes(2, "big") + message
