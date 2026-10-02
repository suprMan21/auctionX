"""KmsKeyProvider — two roots, OpenSSL KDF vectors, no network (S-NFC3.5).

A hand-rolled KMS stub emulates ``generate_mac`` (HMAC-SHA-256) per KeyId; the
roots live only inside the stub, as they would inside KMS. Runs under plain
``pytest`` from tag-encoder/ (testpaths includes providers/).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from providers import kms_key_provider as mod  # noqa: E402
from providers.kms_key_provider import (  # noqa: E402
    DEFAULT_ADMIN_KEY_ALIAS,
    DEFAULT_SDM_KEY_ALIAS,
    KmsKeyProvider,
)
from tag_encoder.keyprovider import LocalKeyProvider  # noqa: E402

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "test-vectors" / "ntag424_sdm_vectors.json").read_text()
)
UID_A = bytes.fromhex("04A27E02936980")
OTHER_ROOT = bytes.fromhex("77" * 32)


class FakeKms:
    def __init__(self, roots: dict[str, bytes], spec="HMAC_256", usage="GENERATE_VERIFY_MAC", enabled=True, short=False):
        self._roots = roots
        self._meta = (spec, usage, enabled)
        self._short = short
        self.calls: list[tuple[str, bytes]] = []

    def generate_mac(self, KeyId, MacAlgorithm, Message):  # noqa: N803 (boto3 casing)
        assert MacAlgorithm == "HMAC_SHA_256"
        self.calls.append((KeyId, bytes(Message)))
        mac = hmac.new(self._roots[KeyId], bytes(Message), hashlib.sha256).digest()
        return {"Mac": mac[:16] if self._short else mac, "KeyId": KeyId}

    def describe_key(self, KeyId):  # noqa: N803
        spec, usage, enabled = self._meta
        return {"KeyMetadata": {"KeyId": KeyId, "KeySpec": spec, "KeyUsage": usage, "Enabled": enabled}}


def _kms(sdm_root: bytes, admin_root: bytes, **kw) -> tuple[KmsKeyProvider, FakeKms]:
    fake = FakeKms({DEFAULT_SDM_KEY_ALIAS: sdm_root, DEFAULT_ADMIN_KEY_ALIAS: admin_root}, **kw)
    return KmsKeyProvider(kms_client=fake), fake


def test_default_aliases_are_the_per_role_staging_pair():
    p = KmsKeyProvider(kms_client=object())
    assert p.key_ids == {"sdm": "alias/am-tag-sdm-staging", "admin": "alias/am-tag-admin-staging"}


def test_same_key_for_both_roots_is_refused():
    with pytest.raises(ValueError):
        KmsKeyProvider(sdm_key_id="alias/x", admin_key_id="alias/x", kms_client=object())


@pytest.mark.parametrize("v", VECTORS["kdf"], ids=[v["name"] for v in VECTORS["kdf"]])
def test_reproduces_openssl_kdf_vectors_and_routes_by_role(v):
    root = bytes.fromhex(v["rootKey"])
    admin = v["role"] == "APP_MASTER"
    p, fake = _kms(OTHER_ROOT if admin else root, root if admin else OTHER_ROOT)
    uid = bytes.fromhex(v["uid"]) if v["uid"] else None
    assert p.derive_key(v["role"], v["version"], uid).hex().upper() == v["key"]
    key_id, message = fake.calls[0]
    assert key_id == (DEFAULT_ADMIN_KEY_ALIAS if admin else DEFAULT_SDM_KEY_ALIAS)
    assert message.hex().upper() == v["message"]


def test_kms_and_local_agree_for_the_same_roots():
    sdm, admin = bytes.fromhex("A1" * 32), bytes.fromhex("B2" * 32)
    kms, _ = _kms(sdm, admin)
    local = LocalKeyProvider(sdm, admin, allow_local_keys=True)
    for role, uid in (("META", None), ("FILE", UID_A), ("APP_MASTER", UID_A)):
        assert kms.derive_key(role, 1, uid) == local.derive_key(role, 1, uid)


def test_no_caching():
    p, fake = _kms(bytes(32), OTHER_ROOT)
    p.derive_key("META", 1)
    p.derive_key("META", 1)
    assert len(fake.calls) == 2


def test_rejects_short_mac():
    p, _ = _kms(bytes(32), OTHER_ROOT, short=True)
    with pytest.raises(RuntimeError):
        p.derive_key("META", 1)


def test_audit_log_has_no_key_mac_or_uid():
    records: list[logging.LogRecord] = []

    class Capture(logging.Handler):
        def emit(self, record):
            records.append(record)

    h = Capture()
    mod.audit_log.addHandler(h)
    mod.audit_log.setLevel(logging.INFO)
    sdm = bytes.fromhex("5C" * 32)
    try:
        p, _ = _kms(sdm, OTHER_ROOT)
        key = p.derive_key("FILE", 1, UID_A)
    finally:
        mod.audit_log.removeHandler(h)

    assert len(records) == 1
    rec = vars(records[0])
    assert rec["event"] == "derive_key" and rec["role"] == "FILE" and rec["key_ref"] == DEFAULT_SDM_KEY_ALIAS
    blob = repr(rec).lower()
    mac = hmac.new(sdm, b"AM-NTAG424-KDF\x00FILE\x00\x01" + UID_A, hashlib.sha256).hexdigest()
    for secret in (key.hex(), mac, sdm.hex(), UID_A.hex()):
        assert secret not in blob


def test_validate_keys():
    _kms(bytes(32), OTHER_ROOT)[0].validate_keys()
    with pytest.raises(RuntimeError):
        _kms(bytes(32), OTHER_ROOT, spec="SYMMETRIC_DEFAULT")[0].validate_keys()
    with pytest.raises(RuntimeError):
        _kms(bytes(32), OTHER_ROOT, enabled=False)[0].validate_keys()


def test_provider_holds_no_secret_bytes():
    p = KmsKeyProvider(kms_client=object())
    for name, val in vars(p).items():
        assert not isinstance(val, (bytes, bytearray)), name
    for name in dir(mod):
        val = getattr(mod, name)
        assert not (isinstance(val, (bytes, bytearray)) and len(val) >= 16), name
