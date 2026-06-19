"""AM-SEALED FIT/NOT-FIT verdict logic."""

from tag_hq import verdict


def test_genuine_gx_is_fit():
    v = verdict.evaluate(
        genuine=True, genuine_reason="ok", is_gx=True, variant="Gx",
        random_id=False, version_notes=[],
    )
    assert v.fit is True
    assert v.badge == "FIT"
    assert "genuine NXP Gx silicon" in v.headline


def test_not_genuine_is_not_fit():
    v = verdict.evaluate(
        genuine=False, genuine_reason="signature invalid", is_gx=True, variant="Gx",
        random_id=False,
    )
    assert v.fit is False
    assert "genuineness unverified" in v.headline


def test_tx_offspec_is_not_fit_and_flagged():
    v = verdict.evaluate(
        genuine=True, genuine_reason="ok", is_gx=False, variant="Tx?/off-spec",
        random_id=False,
    )
    assert v.fit is False
    assert "spec mismatch" in v.headline
    assert any("Tx" in f or "off-spec" in f.lower() for f in v.flags)


def test_random_id_blocks_fit():
    v = verdict.evaluate(
        genuine=False, genuine_reason="random-ID active", is_gx=True, variant="Gx",
        random_id=True,
    )
    assert v.fit is False
    assert any("Random-ID" in f for f in v.flags)


def test_verdict_never_claims_authentic_or_uncloned():
    """Wording guard: verdict must say 'genuine NXP silicon', never 'authentic'/'uncloned'."""
    v = verdict.evaluate(genuine=True, genuine_reason="ok", is_gx=True, variant="Gx", random_id=False)
    blob = " ".join([v.headline, *v.reasons]).lower()
    assert "uncloned" not in blob
    assert "authentic" not in blob
    assert "genuine nxp" in blob
