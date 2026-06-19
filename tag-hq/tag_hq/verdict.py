"""Per-tag AM-SEALED FIT / NOT-FIT verdict.

AM-SEALED stock is genuine plain NTAG 424 DNA + frangible antenna; TagTamper (Tx)
is rejected (Decisions DB 3843…fe47, as amended by 3843…0a59 / DR-9 2026-06-19).
Tag HQ is the acceptance gate that confirms received physical stock conforms
BEFORE any encode.

FIT requires, at minimum:
  1. genuine NXP silicon — the ECC originality signature verifies (§3), AND
  2. the silicon matches the AM-SEALED NTAG 424 DNA reference tuple
     (HW type 0x04 + storage 0x11 + SW sub-type 0x02 + protocol 0x05).

NOTE: we assert on that stable tuple, NOT the brittle HW sub-type nibble — the
prior "Gx = 0x08" reference was an error (0x08 is AN12196's strong-back-modulation
example; genuine plain stock returns 0x02). Plain-vs-TagTamper cannot be proven
from GetVersion bytes alone; an authenticated GetTTStatus is the definitive test
and is out of this read-only station's scope, so a possible-TT tag is flagged
(advisory), and S-NFC2 gates encoding on GetTTStatus.

Wording is deliberate: "genuine NXP silicon" (issued-by-NXP), never
"authentic/uncloned". The anti-clone guarantee is the scan-time SUN/SDM CMAC,
not this station.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Verdict:
    fit: bool
    headline: str          # one-line summary for the catalog row
    reasons: list[str] = field(default_factory=list)   # why FIT / why not
    flags: list[str] = field(default_factory=list)     # spec-mismatch / advisory flags

    @property
    def badge(self) -> str:
        return "FIT" if self.fit else "NOT FIT"


def evaluate(
    *,
    genuine: bool,
    genuine_reason: str,
    matches_reference: bool,
    variant: str,
    random_id: bool,
    possible_tt: bool = False,
    version_notes: list[str] | None = None,
) -> Verdict:
    """Compose the AM-SEALED verdict from the diagnostic facts."""
    reasons: list[str] = []
    flags: list[str] = []
    version_notes = version_notes or []

    if random_id:
        flags.append(
            "Random-ID enabled — real UID hidden; originality verify needs GetCardUID (authenticated). "
            "Read-only station cannot confirm genuineness on a random-ID tag."
        )

    # Gate 1: genuineness.
    if genuine:
        reasons.append("genuine NXP silicon — originality signature verifies (§3)")
    else:
        reasons.append(f"NOT verified as NXP silicon — {genuine_reason}")

    # Gate 2: matches the AM-SEALED NTAG 424 DNA reference tuple.
    if matches_reference:
        reasons.append(
            "matches AM-SEALED NTAG 424 DNA reference (HW type 0x04 + storage 0x11 "
            "+ SW sub-type 0x02 + protocol 0x05)"
        )
    else:
        reasons.append(f"variant '{variant}' does not match the AM-SEALED NTAG 424 DNA reference")
        flags.append(
            "Off-reference silicon. AM-SEALED requires genuine NTAG 424 DNA "
            "(type 0x04 / storage 0x11 / SW sub-type 0x02); this stock does not match."
        )

    # Advisory (does NOT block FIT — functional security model is identical): the
    # bytes cannot exclude TagTamper; S-NFC2 gates encoding on GetTTStatus.
    if possible_tt:
        flags.append(
            "Possible TagTamper (Tx): HW sub-type high nibble is set — not excludable from "
            "GetVersion alone. AM-SEALED rejects Tx; confirm with GetTTStatus / supplier order code "
            "before encoding (S-NFC2 gate)."
        )

    for n in version_notes:
        flags.append(n)

    fit = bool(genuine and matches_reference and not random_id)
    if fit:
        headline = "FIT for AM-SEALED — genuine NXP NTAG 424 DNA"
        if possible_tt:
            headline += " (confirm plain vs TagTamper before encode)"
    elif not genuine:
        headline = "NOT FIT — genuineness unverified"
    elif not matches_reference:
        headline = "NOT FIT — off-reference (not the AM-SEALED NTAG 424 DNA)"
    else:
        headline = "NOT FIT — random-ID blocks genuineness confirmation"

    return Verdict(fit=fit, headline=headline, reasons=reasons, flags=flags)
