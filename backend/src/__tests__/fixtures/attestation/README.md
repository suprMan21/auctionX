Test-only attestation certificates for `hardwareKeyAttestation` tests (S-2FA Ph4).
Made with openssl on 2026-10-28; valid ~74 years. The private keys protect nothing
and are never trusted outside tests (tests swap them in with `__setHardwareKeyRoots`).
