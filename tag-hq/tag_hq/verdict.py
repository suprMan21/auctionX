"""Per-tag AM-SEALED FIT / NOT-FIT verdict.

AM-SEALED stock is LOCKED to NTAG 424 DNA **Gx** + frangible antenna; TT/Tx is
rejected (Decisions DB 3843…fe47). Tag HQ is the acceptance gate that confirms
received physical stock conforms BEFORE any encode.

FIT requires, at minimum:
  1. genuine NXP silicon — the ECC originality signature verifies (§3), AND
  2. the silicon is the Gx variant (Tx/off-spec is rejected hardware).

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
    is_gx: bool,
    variant: str,
    random_id: bool,
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

    # Gate 2: Gx variant.
    if is_gx:
        reasons.append("Gx variant confirmed (GetVersion matches locked Gx reference)")
    else:
        reasons.append(f"variant is '{variant}', not Gx — spec mismatch")
        flags.append(
            "Off-spec / Tx variant flagged. AM-SEALED is locked to Gx + frangible antenna; "
            "Tx/TT is rejected hardware (detect-and-flag only)."
        )

    for n in version_notes:
        flags.append(n)

    fit = bool(genuine and is_gx and not random_id)
    if fit:
        headline = "FIT for AM-SEALED — genuine NXP Gx silicon"
    elif not genuine:
        headline = "NOT FIT — genuineness unverified"
    elif not is_gx:
        headline = "NOT FIT — spec mismatch (not Gx)"
    else:
        headline = "NOT FIT — random-ID blocks genuineness confirmation"

    return Verdict(fit=fit, headline=headline, reasons=reasons, flags=flags)
