"""AM-SEALED FIT/NOT-FIT verdict logic (re-pinned to the corrected reference, DR-9)."""

from tag_hq import verdict


def test_genuine_matching_424dna_is_fit():
    v = verdict.evaluate(
        genuine=True, genuine_reason="ok", matches_reference=True,
        variant="NTAG 424 DNA (plain)", random_id=False,
    )
    assert v.fit is True
    assert v.badge == "FIT"
    assert "genuine NXP NTAG 424 DNA" in v.headline


def test_not_genuine_is_not_fit():
    v = verdict.evaluate(
        genuine=False, genuine_reason="signature invalid", matches_reference=True,
        variant="NTAG 424 DNA (plain)", random_id=False,
    )
    assert v.fit is False
    assert "genuineness unverified" in v.headline


def test_off_reference_is_not_fit_and_flagged():
    v = verdict.evaluate(
        genuine=True, genuine_reason="ok", matches_reference=False,
        variant="NXP, off-reference", random_id=False,
    )
    assert v.fit is False
    assert "off-reference" in v.headline
    assert any("does not match" in f for f in v.flags)


def test_possible_tagtamper_is_advisory_not_blocking():
    """A possible-TT tag still FITs (security model identical) but is flagged for GetTTStatus."""
    v = verdict.evaluate(
        genuine=True, genuine_reason="ok", matches_reference=True,
        variant="NTAG 424 DNA (TagTamper?)", random_id=False, possible_tt=True,
    )
    assert v.fit is True
    assert any("TagTamper" in f for f in v.flags)
    assert "TagTamper" in v.headline


def test_random_id_blocks_fit():
    v = verdict.evaluate(
        genuine=False, genuine_reason="random-ID active", matches_reference=True,
        variant="NTAG 424 DNA (plain)", random_id=True,
    )
    assert v.fit is False
    assert any("Random-ID" in f for f in v.flags)


def test_verdict_never_claims_authentic_or_uncloned():
    """Wording guard: 'genuine NXP silicon', never 'authentic'/'uncloned'."""
    v = verdict.evaluate(genuine=True, genuine_reason="ok", matches_reference=True,
                         variant="NTAG 424 DNA (plain)", random_id=False)
    blob = " ".join([v.headline, *v.reasons]).lower()
    assert "uncloned" not in blob
    assert "authentic" not in blob
    assert "genuine nxp" in blob
