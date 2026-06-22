"""Contract + determinism tests for KmsKeyProvider.

These tests NEVER hit real AWS. They inject a hand-rolled KMS stub that
emulates ``generate_mac`` (HMAC-SHA-256 over the message) and ``describe_key``.
The stub holds a throwaway test root only on the *stub* side, mirroring how a
real KMS HMAC CMK holds the root server-side: the provider under test never sees
it. moto is not required (and is not installed here), so the stub keeps the test
self-contained.

Run:  python3 -m pytest tag-encoder/providers/test_kms_key_provider.py
  or:  python3 tag-encoder/providers/test_kms_key_provider.py   (no pytest needed)
"""

from __future__ import annotations

import hashlib
import hmac
import os
import sys

# Allow running both as `pytest tag-encoder/...` and as a direct script.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import kms_key_provider as mod  # noqa: E402
from kms_key_provider import (  # noqa: E402
    AES128_KEY_LEN,
    NTAG424_UID_LEN,
    KmsKeyProvider,
)


class FakeKmsClient:
    """Minimal deterministic stand-in for boto3's KMS client.

    The "root" lives only inside this fake, never inside KmsKeyProvider —
    exactly the property the real KMS boundary gives us.
    """

    def __init__(self, root: bytes = b"\xAB" * 32, key_spec: str = "HMAC_256",
                 key_usage: str = "GENERATE_VERIFY_MAC", enabled: bool = True):
        self._root = root
        self._key_spec = key_spec
        self._key_usage = key_usage
        self._enabled = enabled
        self.generate_mac_calls = []  # records messages for assertions

    def generate_mac(self, KeyId, MacAlgorithm, Message):  # noqa: N803 (boto3 casing)
        assert MacAlgorithm == "HMAC_SHA_256"
        self.generate_mac_calls.append(bytes(Message))
        mac = hmac.new(self._root, bytes(Message), hashlib.sha256).digest()
        return {"Mac": mac, "KeyId": KeyId, "MacAlgorithm": MacAlgorithm}

    def describe_key(self, KeyId):  # noqa: N803
        return {
            "KeyMetadata": {
                "KeyId": KeyId,
                "KeySpec": self._key_spec,
                "KeyUsage": self._key_usage,
                "Enabled": self._enabled,
            }
        }


UID_A = bytes.fromhex("04A27E02936980")  # 7 bytes, real-shaped NTAG 424 UID
UID_B = bytes.fromhex("04DEADBEEF1234")  # 7 bytes, different


def _provider(client=None, **kw):
    return KmsKeyProvider(key_id="alias/am-tag-root", kms_client=client or FakeKmsClient(), **kw)


# --- contract / shape -------------------------------------------------------

def test_returns_16_byte_key():
    key = _provider().derive_tag_key(UID_A)
    assert isinstance(key, (bytes, bytearray))
    assert len(key) == AES128_KEY_LEN == 16


def test_uid_length_enforced():
    p = _provider()
    for bad in (b"", b"\x00" * 6, b"\x00" * 8):
        try:
            p.derive_tag_key(bad)
        except ValueError:
            pass
        else:
            raise AssertionError("expected ValueError for %d-byte UID" % len(bad))
    assert NTAG424_UID_LEN == 7


def test_non_bytes_rejected():
    p = _provider()
    try:
        p.derive_tag_key("04A27E02936980")  # str, not bytes
    except TypeError:
        return
    raise AssertionError("expected TypeError for non-bytes UID")


# --- determinism ------------------------------------------------------------

def test_same_uid_same_key_same_client():
    p = _provider()
    assert p.derive_tag_key(UID_A) == p.derive_tag_key(UID_A)


def test_same_uid_same_key_across_provider_instances_same_root():
    root = b"\x11\x22\x33" * 10 + b"\x44\x55"  # fixed 32-byte test root
    c1, c2 = FakeKmsClient(root=root), FakeKmsClient(root=root)
    k1 = _provider(c1).derive_tag_key(UID_A)
    k2 = _provider(c2).derive_tag_key(UID_A)
    assert k1 == k2  # deterministic for a given UID + root


def test_different_uid_different_key():
    p = _provider()
    assert p.derive_tag_key(UID_A) != p.derive_tag_key(UID_B)


def test_different_root_different_key():
    k_root1 = _provider(FakeKmsClient(root=b"\x01" * 32)).derive_tag_key(UID_A)
    k_root2 = _provider(FakeKmsClient(root=b"\x02" * 32)).derive_tag_key(UID_A)
    assert k_root1 != k_root2


def test_mac_sent_is_the_uid():
    c = FakeKmsClient()
    _provider(c).derive_tag_key(UID_A)
    assert c.generate_mac_calls == [UID_A]  # KMS signs the raw UID, nothing else


# --- security: no root key material anywhere in the provider ----------------

def test_no_root_key_constant_at_module_level():
    """No 16/32-byte bytes constant in the provider module that could be a root.

    Allow-list the public, non-secret HKDF info label and small protocol
    constants; flag anything else that looks like fixed key material.
    """
    allow = {mod._HKDF_INFO}
    for name in dir(mod):
        val = getattr(mod, name)
        if isinstance(val, (bytes, bytearray)) and len(val) >= 16:
            assert val in allow, (
                "suspicious >=16-byte bytes constant %r in module" % name
            )


def test_provider_instance_holds_no_secret_material():
    p = _provider()
    # Only non-secret config should be on the instance.
    for attr in ("key_id", "region", "principal"):
        assert hasattr(p, attr)
    # No attribute should hold a 32-byte (or 16-byte) opaque blob = a key/root.
    for k, v in vars(p).items():
        if isinstance(v, (bytes, bytearray)):
            raise AssertionError("provider holds bytes attr %r (possible key)" % k)


def test_audit_log_emitted_without_key_material(caplog=None):
    import logging

    records = []

    class Capture(logging.Handler):
        def emit(self, record):
            records.append(record)

    handler = Capture()
    mod.audit_log.addHandler(handler)
    mod.audit_log.setLevel(logging.INFO)
    try:
        key = _provider(principal="encoder-svc@am").derive_tag_key(UID_A)
    finally:
        mod.audit_log.removeHandler(handler)

    assert len(records) == 1
    rec = records[0]
    assert getattr(rec, "event", None) == "derive_tag_key"
    assert getattr(rec, "principal", None) == "encoder-svc@am"
    assert getattr(rec, "tag_uid", None) == UID_A.hex()
    assert getattr(rec, "key_ref", None) == "alias/am-tag-root"
    # The derived key (hex or raw) must not appear in the structured record.
    blob = repr(vars(rec))
    assert key.hex() not in blob
    assert key not in (getattr(rec, a, None) for a in vars(rec))


# --- key validation (kms:DescribeKey) ---------------------------------------

def test_validate_key_accepts_good_key():
    _provider().validate_key()  # should not raise


def test_validate_key_rejects_wrong_spec():
    bad = FakeKmsClient(key_spec="RSA_2048", key_usage="ENCRYPT_DECRYPT")
    try:
        _provider(bad).validate_key()
    except RuntimeError:
        return
    raise AssertionError("expected RuntimeError for non-HMAC key")


def test_validate_key_rejects_disabled_key():
    try:
        _provider(FakeKmsClient(enabled=False)).validate_key()
    except RuntimeError:
        return
    raise AssertionError("expected RuntimeError for disabled key")


# --- standalone runner (no pytest required) ---------------------------------

def _run_standalone():
    fns = [v for k, v in sorted(globals().items())
           if k.startswith("test_") and callable(v)]
    passed = 0
    for fn in fns:
        fn()
        passed += 1
        print("PASS", fn.__name__)
    print("\n%d/%d tests passed" % (passed, len(fns)))
    return passed == len(fns)


if __name__ == "__main__":
    sys.exit(0 if _run_standalone() else 1)
