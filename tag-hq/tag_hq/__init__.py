"""Tag HQ — read-only NTAG 424 DNA diagnostic console (S-NFC1).

Hardware bring-up + acceptance-inspection station that runs BEFORE the
encoder (S-NFC2) ever writes a key. Read-only: zero write/encode APDUs,
no key material ever read, logged, or stored (key VERSION only).

Modules are built to be imported/harvested by the S-NFC2 encoder tool:
    transport    PC-SC reader I/O + read-only command whitelist
    apdu         named C-APDU constants for the allowed read set
    genuineness  ECC NXP originality-signature verify (§3, LOCKED params)
    parsers      GetVersion/CC/NDEF/FileSettings/key-version/crypto-mode
    verdict      per-tag AM-SEALED FIT / NOT-FIT
    catalog      local SQLite store, keyed on 7-byte UID
    server       FastAPI shell bound to 127.0.0.1
"""

__version__ = "1.0.0"
