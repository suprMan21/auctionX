"""Key-derivation providers for the NTAG 424 DNA tag encoder (S-NFC2, Lane B).

The encoder core selects a provider that satisfies the ``KeyProvider`` Protocol.
``KmsKeyProvider`` is the production backend (AWS KMS HMAC CMK, us-east-2). A
future ``YubiHsmKeyProvider`` will slot in behind the same Protocol with no
encoder-core changes (see README.md).
"""

from .kms_key_provider import KeyProvider, KmsKeyProvider

__all__ = ["KeyProvider", "KmsKeyProvider"]
