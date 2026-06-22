"""Self-contained pure-Python AES-128 core (ECB block cipher + CBC + CMAC).

WHY PURE PYTHON: this package must produce byte-identical output to the
backend simulator (`backend/src/services/nfc/ntag424Simulator.ts`) with ZERO
runtime crypto dependencies, so the parity tests run anywhere `pytest` runs
(no `cryptography`/`pycryptodome` install, no native build). The algorithms
here are the standard FIPS-197 (AES) and RFC 4493 (AES-CMAC); validated in
tests against the FIPS-197 known-answer vector and against golden vectors
pulled straight from the TypeScript simulator.

This is NOT a hardened crypto library — it is a deterministic, auditable
reference implementation for SIM parity. Real key material lives behind the
KeyProvider abstraction (see keyprovider.py); for the production AWS-KMS path
the encrypt/CMAC happens in KMS, not here.

Sources: FIPS-197 (AES), RFC 4493 (AES-128-CMAC), NXP AN12196.
"""

from __future__ import annotations

# --- AES-128 S-box / inverse not needed (encrypt-only) ---------------------

_SBOX = bytes.fromhex(
    "637c777bf26b6fc53001672bfed7ab76"
    "ca82c97dfa5947f0add4a2af9ca472c0"
    "b7fd9326363ff7cc34a5e5f171d83115"
    "04c723c31896059a071280e2eb27b275"
    "09832c1a1b6e5aa0523bd6b329e32f84"
    "53d100ed20fcb15b6acbbe394a4c58cf"
    "d0efaafb434d338545f9027f503c9fa8"
    "51a3408f929d38f5bcb6da2110fff3d2"
    "cd0c13ec5f974417c4a77e3d645d1973"
    "60814fdc222a908846eeb814de5e0bdb"
    "e0323a0a4906245cc2d3ac629195e479"
    "e7c8376d8dd54ea96c56f4ea657aae08"
    "ba78252e1ca6b4c6e8dd741f4bbd8b8a"
    "703eb5664803f60e613557b986c11d9e"
    "e1f8981169d98e949b1e87e9ce5528df"
    "8ca1890dbfe6426841992d0fb054bb16"
)

_RCON = (0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1B, 0x36)


def _xtime(a: int) -> int:
    a <<= 1
    if a & 0x100:
        a ^= 0x11B
    return a & 0xFF


def _mul(a: int, b: int) -> int:
    """GF(2^8) multiply."""
    res = 0
    for _ in range(8):
        if b & 1:
            res ^= a
        b >>= 1
        a = _xtime(a)
    return res & 0xFF


def _expand_key(key: bytes) -> list[list[int]]:
    """AES-128 key schedule -> 11 round keys, each a list of 16 bytes."""
    if len(key) != 16:
        raise ValueError("AES-128 key must be 16 bytes")
    words: list[list[int]] = [list(key[i * 4 : i * 4 + 4]) for i in range(4)]
    for i in range(4, 44):
        temp = list(words[i - 1])
        if i % 4 == 0:
            temp = temp[1:] + temp[:1]  # RotWord
            temp = [_SBOX[b] for b in temp]  # SubWord
            temp[0] ^= _RCON[i // 4 - 1]
        words.append([words[i - 4][j] ^ temp[j] for j in range(4)])
    round_keys: list[list[int]] = []
    for r in range(11):
        rk: list[int] = []
        for c in range(4):
            rk.extend(words[r * 4 + c])
        round_keys.append(rk)
    return round_keys


def _add_round_key(state: list[int], rk: list[int]) -> None:
    for i in range(16):
        state[i] ^= rk[i]


def _sub_bytes(state: list[int]) -> None:
    for i in range(16):
        state[i] = _SBOX[state[i]]


def _shift_rows(state: list[int]) -> None:
    # State is column-major: index = row + 4*col
    new = state[:]
    for row in range(1, 4):
        for col in range(4):
            new[row + 4 * col] = state[row + 4 * ((col + row) % 4)]
    state[:] = new


def _mix_columns(state: list[int]) -> None:
    for c in range(4):
        i = 4 * c
        a0, a1, a2, a3 = state[i], state[i + 1], state[i + 2], state[i + 3]
        state[i] = _mul(a0, 2) ^ _mul(a1, 3) ^ a2 ^ a3
        state[i + 1] = a0 ^ _mul(a1, 2) ^ _mul(a2, 3) ^ a3
        state[i + 2] = a0 ^ a1 ^ _mul(a2, 2) ^ _mul(a3, 3)
        state[i + 3] = _mul(a0, 3) ^ a1 ^ a2 ^ _mul(a3, 2)


def aes128_encrypt_block(key: bytes, block: bytes) -> bytes:
    """Encrypt a single 16-byte block with AES-128 (ECB primitive)."""
    if len(block) != 16:
        raise ValueError("AES block must be 16 bytes")
    rks = _expand_key(key)
    state = list(block)
    _add_round_key(state, rks[0])
    for rnd in range(1, 10):
        _sub_bytes(state)
        _shift_rows(state)
        _mix_columns(state)
        _add_round_key(state, rks[rnd])
    _sub_bytes(state)
    _shift_rows(state)
    _add_round_key(state, rks[10])
    return bytes(state)


def aes128_cbc_encrypt_nopad(key: bytes, iv: bytes, data: bytes) -> bytes:
    """AES-128-CBC encrypt, NO padding. data length must be a multiple of 16."""
    if len(data) % 16 != 0:
        raise ValueError("CBC data must be a multiple of 16 bytes")
    prev = bytes(iv)
    out = bytearray()
    for off in range(0, len(data), 16):
        block = bytes(a ^ b for a, b in zip(data[off : off + 16], prev))
        prev = aes128_encrypt_block(key, block)
        out.extend(prev)
    return bytes(out)


# --- AES-128-CMAC (RFC 4493) ----------------------------------------------

def _left_shift_one(b: bytes) -> bytes:
    n = int.from_bytes(b, "big") << 1
    return (n & ((1 << (len(b) * 8)) - 1)).to_bytes(len(b), "big")


def _derive_subkey(L: bytes) -> bytes:
    """RFC 4493 subkey derivation step (also matches the TS `deriveSubkey`)."""
    shifted = bytearray(_left_shift_one(L))
    if L[0] & 0x80:
        shifted[-1] ^= 0x87  # Rb for 128-bit block
    return bytes(shifted)


def aes128_cmac(key: bytes, message: bytes) -> bytes:
    """Full 16-byte AES-128-CMAC (RFC 4493).

    Byte-for-byte equivalent to `computeCmac()` in ntag424.ts. NOTE the TS
    code treats an EMPTY message as a single (padded) block — this mirrors
    that with `numBlocks = max(1, ...)`; both differ harmlessly from RFC 4493
    on the empty input but the NTAG path never CMACs an empty message.
    """
    L = aes128_encrypt_block(key, bytes(16))
    K1 = _derive_subkey(L)
    K2 = _derive_subkey(K1)

    block_size = 16
    num_blocks = max(1, (len(message) + block_size - 1) // block_size)
    last = num_blocks - 1
    complete = len(message) > 0 and len(message) % block_size == 0

    blocks = [bytearray(message[i * block_size : (i + 1) * block_size]) for i in range(num_blocks)]

    if complete:
        last_block = bytes(a ^ b for a, b in zip(blocks[last], K1))
    else:
        padded = bytearray(block_size)
        partial = blocks[last]
        padded[: len(partial)] = partial
        padded[len(partial)] = 0x80
        last_block = bytes(a ^ b for a, b in zip(padded, K2))
    blocks[last] = bytearray(last_block)

    x = bytes(16)
    for block in blocks:
        xored = bytes(a ^ b for a, b in zip(x, block))
        x = aes128_encrypt_block(key, xored)
    return x
