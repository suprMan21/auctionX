"""Static guard (S-NFC3.5): no code path creates, aliases or imports a KMS key.

Python mirror of backend/src/__tests__/nfcKeyGuards.test.ts, so the encoder
suite fails on its own if someone scripts KMS setup here. One-time key setup
is a documented Boss action, never code — and never a key per tag.
"""

import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
SCAN_DIRS = ["tag-encoder", "tag-hq", "backend/src", "backend/scripts"]
EXTS = {".py", ".ts", ".js", ".sh"}
SKIP = {"node_modules", ".venv", "venv", "__pycache__", ".pytest_cache", "dist"}
PATTERN = re.compile(
    r"CreateKey|CreateAlias|ImportKeyMaterial|create_key|create_alias|import_key_material"
    r"|GetParametersForImport|get_parameters_for_import"
)
SELF = Path(__file__).resolve()
TS_GUARD = APP_ROOT / "backend/src/__tests__/nfcKeyGuards.test.ts"


def _files():
    for d in SCAN_DIRS:
        for p in (APP_ROOT / d).rglob("*"):
            if p.is_file() and p.suffix in EXTS and not (SKIP & set(p.parts)):
                yield p


def test_scans_a_real_number_of_files():
    files = list(_files())
    assert len(files) > 80
    assert any(p.name == "kms_key_provider.py" for p in files)


def test_no_kms_key_creation_anywhere():
    hits = []
    for p in _files():
        if p.resolve() in (SELF, TS_GUARD):
            continue
        for i, line in enumerate(p.read_text(errors="replace").splitlines(), 1):
            if PATTERN.search(line):
                hits.append(f"{p.relative_to(APP_ROOT)}:{i}: {line.strip()}")
    assert hits == []
