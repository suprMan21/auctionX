"""§3 — NXP Originality-Signature verification (the one test a clone cannot pass).

LOCKED parameters (Decisions DB: "NTAG 424 DNA originality-check parameters
locked (Read_Sig / secp224r1 / AN12196 key)", 3843baf6966481059191d83a373217ad;
spec 3843baf6966481c28580c6fdb57c296e). Do NOT edit these constants from memory —
they are sourced to AN12196 Rev 2.0 §8/Table 30 and the NT4H2421Gx datasheet.

CRITICAL SCOPE: a passing verify proves the (UID, signature) pair was ISSUED BY
NXP, i.e. "genuine NXP silicon". It does NOT prove the die is uncloned — a cloner
can copy a genuine (UID, sig) pair onto clone silicon and pass this check. The
anti-clone moat is the scan-time SUN/SDM CMAC (secret AES key, never leaves the
chip), a separate already-locked mechanism on the /t endpoint. Label accordingly.
"""

from __future__ import annotations

from dataclasses import dataclass

from ecdsa import BadSignatureError, NIST224p, VerifyingKey
from ecdsa.util import sigdecode_string

# --- LOCKED constants (AN12196 Rev 2.0 §8) ---------------------------------

# NXP originality public key, uncompressed X||Y over secp224r1 / NIST P-224.
# (NOT secp128r1 — that is the NTAG 21x key/curve and silently waves clones through.)
NXP_PUB_X = "8A9B380AF2EE1B98DC417FECC263F8449C7625CECE82D9B916C992DA"
NXP_PUB_Y = "209D68422B81EC20B65A66B5102A61596AF3379200599316A00A1410"
NXP_PUB_XY = bytes.fromhex(NXP_PUB_X + NXP_PUB_Y)

# secp224r1 ECDSA signatures are 56 bytes: raw r||s, 28 + 28 (NOT DER).
SIGNATURE_LEN = 56
UID_LEN = 7

# AN12196 Table 30 self-test vector. If this does not verify, the
# key/curve/decode wiring is wrong — gate everything on it.
SELFTEST_UID = bytes.fromhex("04518DFAA96180")
SELFTEST_SIG = bytes.fromhex(
    "D1940D17CFEDA4BFF80359AB975F9F6514313E8F90C1D3CAAF5941AD"
    "744A1CDF9A83F883CAFE0FE95D1939B1B7E47113993324473B785D21"
)

_VK = VerifyingKey.from_string(NXP_PUB_XY, curve=NIST224p)


@dataclass(frozen=True)
class OriginalityResult:
    """Outcome of an NXP originality-signature verification."""

    genuine: bool
    uid_hex: str
    reason: str  # human-readable detail (pass detail, or why it failed)

    @property
    def label(self) -> str:
        # Precise wording is load-bearing: issued-by-NXP, NOT "authentic/uncloned".
        return "genuine NXP silicon" if self.genuine else "NOT verified as NXP silicon"


def verify_originality(uid: bytes, signature: bytes) -> OriginalityResult:
    """Verify a 56-byte ECDSA originality signature over the raw 7-byte UID.

    Scheme (LOCKED): NIST P-224, raw 7-byte UID fed directly as the message
    representative (NO hash), raw r||s decode, against the AN12196 public key.
    """
    uid_hex = uid.hex().upper()

    if len(uid) != UID_LEN:
        return OriginalityResult(False, uid_hex, f"UID must be {UID_LEN} bytes, got {len(uid)}")
    if len(signature) != SIGNATURE_LEN:
        return OriginalityResult(
            False, uid_hex, f"signature must be {SIGNATURE_LEN} bytes, got {len(signature)}"
        )

    try:
        # verify_digest treats `uid` as the already-final message representative
        # (no hashing) — exactly the NTAG 424 DNA scheme.
        _VK.verify_digest(signature, uid, sigdecode=sigdecode_string)
        return OriginalityResult(True, uid_hex, "ECDSA signature valid for UID over secp224r1")
    except BadSignatureError:
        return OriginalityResult(
            False, uid_hex, "signature invalid (clone, wrong UID, or non-NXP key)"
        )


def run_selftest() -> OriginalityResult:
    """Run the AN12196 Table 30 vector. MUST return genuine=True.

    Call this at startup as a gate before trusting any field read.
    """
    return verify_originality(SELFTEST_UID, SELFTEST_SIG)
