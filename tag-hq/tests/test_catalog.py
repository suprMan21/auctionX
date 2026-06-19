"""Catalog persistence — keyed on UID hex, stores no key material."""

from tag_hq.catalog import Catalog


def _snapshot(uid="04518DFAA96180", fit=True, genuine=True):
    return {
        "uid_hex": uid, "genuine": genuine, "variant": "Gx",
        "verdict": {"fit": fit, "headline": "FIT for AM-SEALED — genuine NXP Gx silicon"},
        "key_config": {"versions": {"key_0": 0, "key_1": 0}},  # VERSIONS only, never key bytes
    }


def test_record_and_recent(tmp_path):
    cat = Catalog(tmp_path / "t.db")
    sid = cat.record(_snapshot())
    assert sid == 1
    rows = cat.recent()
    assert len(rows) == 1
    assert rows[0].uid_hex == "04518DFAA96180"
    assert rows[0].fit is True


def test_stats_and_history(tmp_path):
    cat = Catalog(tmp_path / "t.db")
    cat.record(_snapshot(fit=True))
    cat.record(_snapshot(fit=False, genuine=False))
    cat.record(_snapshot(uid="04AABBCCDDEE01", fit=True))
    stats = cat.stats()
    assert stats["total"] == 3
    assert stats["fit"] == 2
    assert stats["not_fit"] == 1
    assert stats["distinct_tags"] == 2
    hist = cat.history_for_uid("04518DFAA96180")
    assert len(hist) == 2


def test_catalog_never_persists_key_material(tmp_path):
    """Defensive: the stored JSON should carry key VERSIONS, not any 16-byte key blob."""
    cat = Catalog(tmp_path / "t.db")
    cat.record(_snapshot())
    row = cat.recent()[0]
    versions = row.diagnostic["key_config"]["versions"]
    for v in versions.values():
        assert isinstance(v, int) and 0 <= v <= 255  # a version byte, not key material
