# NTAG 424 DNA — Crypto Reference (Phase-1 Simulator Parity)

> **Status:** Phase-1 (simulator-parity) reference. This documents the crypto the
> existing AuctionX backend simulator and verify-side actually implement today, so
> the S-NFC2 encoder can produce bytes the backend `validateScan` will accept.
>
> **⚠️ CRITICAL — read [Known Gap](#known-gap--this-is-not-yet-an12196-sdm) before
> trusting any of this against real silicon.** The CMAC scheme described here is a
> *simplified* scheme, deliberately matched to the simulator. It is **NOT** the full
> NXP AN12196 SDM session-key / session-CMAC derivation that a genuine NTAG 424 DNA
> chip emits. Phase 2 (real hardware) must align both the encoder and the backend to
> true AN12196 SDM. This is a tracked, intentional gap — not a bug.

---

## 1. Authoritative sources in this repo

| Concern | File | Symbol |
|---|---|---|
| PICC plaintext layout + AES-CBC encrypt | `backend/src/services/nfc/ntag424Simulator.ts:8` | `encryptPiccData` |
| PICC AES-CBC decrypt | `backend/src/services/nfc/ntag424.ts:26` | `decryptPiccData` |
| AES-CMAC (RFC 4493) | `backend/src/services/nfc/ntag424.ts:53` | `computeCmac` |
| CMAC verify (truncated 8B) | `backend/src/services/nfc/ntag424.ts:106` | `verifyCmac` |
| Tap simulation (encrypt → CMAC → URL) | `backend/src/services/nfc/ntag424Simulator.ts:55` | `simulateTap` |
| Full verify pipeline | `backend/src/services/nfc/ntag424.ts:116` | `validateScan` |

NXP reference docs cited by the read-only diagnostic station:
`tag-hq/tag_hq/parsers.py:4-5` (AN12196 Rev 2.0, NT4H2421Gx datasheet Rev 3.0).

---

## 2. PICCData plaintext block

The PICC plaintext is a single 16-byte AES block, laid out exactly as
`encryptPiccData` builds it (`ntag424Simulator.ts:13-20`):

```
offset  bytes  value
------  -----  -----------------------------------------------
0       1      0xC7                 header / tag byte
1..7    7      UID                  the 7-byte tag UID
8..10   3      counter (LE)         read counter, 3 bytes little-endian
11..15  5      0x00 * 5             zero padding to fill the 16-byte block
```

Constraints enforced in code:

- `uidHex` must be exactly 14 hex chars / 7 bytes (`ntag424Simulator.ts:9`).
- `aesKeyHex` must be exactly 32 hex chars / 16 bytes — AES-128 (`ntag424Simulator.ts:10`).
- `counter` must fit in 3 bytes, i.e. `0 .. 0xFFFFFF` (`ntag424Simulator.ts:11`).

Counter encoding is little-endian on both sides:

- write (`ntag424Simulator.ts:17-19`):
  `block[8]=ctr&0xff; block[9]=(ctr>>8)&0xff; block[10]=(ctr>>16)&0xff`
- read (`ntag424.ts:41`):
  `counter = d[8] | (d[9]<<8) | (d[10]<<16)`

> **Note on the header byte.** The simulator uses a fixed `0xC7` constant and the
> verify side asserts `decrypted[0] === 0xC7` (`ntag424.ts:37`). On genuine NTAG 424
> DNA, the leading PICCData byte is a **PICCDataTag** whose bits encode which fields
> (UID present, counter present) are mirrored, and is therefore not a fixed `0xC7`.
> The fixed value here is a simulator simplification. See [Known Gap](#known-gap--this-is-not-yet-an12196-sdm).

---

## 3. PICC encryption — AES-128-CBC, zero IV

`encryptPiccData` (`ntag424Simulator.ts:21-27`):

- Algorithm: `aes-128-cbc`.
- Key: the 16-byte per-tag AES key.
- IV: **16 zero bytes** (`Buffer.alloc(16, 0)`).
- Padding: **disabled** (`cipher.setAutoPadding(false)`) — input is already exactly
  one 16-byte block, so output is exactly 16 bytes / 32 hex chars.

Decryption is the mirror (`ntag424.ts:28-34`): `aes-128-cbc`, same zero IV, padding
disabled. After decrypt it validates the `0xC7` header and returns `{ uid, counter }`,
returning `null` on any throw or header mismatch (`ntag424.ts:36-46`).

The result is uppercased hex, e.g. `encPiccData = 32 hex chars`.

---

## 4. CMAC — AES-128-CMAC (RFC 4493), over the **encrypted** PICC, truncated to 8 bytes

This is the part that is simulator-specific. Read carefully.

### 4.1 What is MAC'd

The simulator MACs **the encrypted PICC ciphertext itself** — not a session-derived
message, not the URL. From `simulateTap` (`ntag424Simulator.ts:56-58`):

```
piccData = encryptPiccData(uid, counter, key)   // 16-byte ciphertext, hex
cmacFull = computeCmac(piccData, key)            // CMAC over that ciphertext, SAME key
cmac     = cmacFull.substring(0, 16)             // first 8 bytes → 16 hex chars
```

The verify side mirrors this exactly. `validateScan` sets
`cmacMessage = parts.encPiccData` and calls
`verifyCmac(cmacMessage, storedAesKey, parts.cmac)` (`ntag424.ts:137-138`). So:

- **MAC input** = the encrypted PICC ciphertext bytes (the same hex passed in `picc_data`).
- **MAC key** = the tag's stored AES key — the *same* key used for PICC encryption.
- **Truncation** = first 8 bytes / 16 hex chars (`verifyCmac`, `ntag424.ts:108-109`;
  `simulateTap`, `ntag424Simulator.ts:58`).

### 4.2 The CMAC algorithm itself (RFC 4493)

`computeCmac` (`ntag424.ts:53-100`) is a faithful AES-128-CMAC:

1. **Subkey generation** (`ntag424.ts:58-64`): `L = AES-ECB(key, 0^128)`, then
   `K1 = subkey(L)`, `K2 = subkey(K1)`.
2. **Subkey left-shift + Rb** (`deriveSubkey`, `ntag424.ts:152-163`): one-bit left
   shift across the 16-byte block; if the MSB of the input was set, XOR the last byte
   with `0x87` (Rb for the 128-bit block).
3. **Last-block handling** (`ntag424.ts:77-88`): if the message is a non-empty exact
   multiple of 16, XOR the last block with `K1`; otherwise `0x80`-pad and XOR with `K2`.
4. **CBC-MAC chain** (`ntag424.ts:91-97`): iterate `X = AES-ECB(key, X ⊕ block)`.

For the SUN case the message is exactly 16 bytes (the ciphertext), so the complete-block
path (`K1`) is taken. Output is uppercased hex; only the first 16 hex chars are kept.

---

## 5. Putting it together — the simulator tap

`simulateTap` (`ntag424Simulator.ts:55-61`) is the canonical encode/emit reference for
the S-NFC2 encoder:

```
piccData = AES-128-CBC(zeroIV, key, 0xC7||UID||ctrLE||0^5)    → 32 hex
cmac     = AES-128-CMAC(key, piccData)[:8]                    → 16 hex
sunUrl   = {baseUrl}/verify/{tokenName}?picc_data={piccData}&cmac={cmac}
```

The verify pipeline `validateScan` (`ntag424.ts:116-148`) then:

1. parses `picc_data` + `cmac` from the URL (`parseSunMessage`, `ntag424.ts:8-19`),
2. AES-CBC-decrypts PICC, checks `0xC7` header, recovers UID + counter,
3. checks decrypted UID equals the stored tag UID (`ntag424.ts:132`),
4. verifies the truncated CMAC over the ciphertext (`ntag424.ts:137-138`),
5. enforces strictly-increasing counter for replay protection
   (`decrypted.counter <= lastCounter` → reject, `ntag424.ts:143`).

For the encoder, an encoded tag is "correct" iff a `simulateTap` against it produces a
URL that `validateScan` accepts with the same stored key, UID, and a `lastCounter`
below the encoded counter.

---

## Known Gap — this is NOT yet AN12196 SDM

The scheme above is the **Phase-1 simulator-parity** target. It diverges from genuine
NTAG 424 DNA silicon (NXP AN12196 SDM / SUN) in at least these ways:

1. **CMAC is computed directly with the file/app AES key over the ciphertext.**
   Genuine NTAG 424 DNA derives an **SDM session MAC key** (`SesSDMFileReadMACKey`) via
   a CMAC-based key-derivation from the file key and the SDMReadCtr, and then computes
   the **SDMMAC** over the SDM-mirrored input (per the file's SDM config), not directly
   over the encrypted PICC with the raw key. The simulator's "CMAC over ciphertext with
   the raw key" is a stand-in.

2. **PICCData encryption key.** Real silicon encrypts PICCData with an SDM-derived
   session key (`SesSDMFileReadENCKey`) tied to the read counter, not the raw file key
   under a fixed zero IV.

3. **PICCDataTag header byte is fixed `0xC7`** here; on real silicon the leading byte is
   a config-dependent tag indicating which fields are mirrored.

4. **No session-key derivation, no SDMReadCtr-bound IV** — both encrypt and MAC reuse
   the static per-tag AES-128 key.

**Implication for Phase 2 (real hardware).** When the encoder writes real silicon, the
chip will emit AN12196-conformant SUN messages. The backend `validateScan` as written
(`ntag424.ts:116`) will **not** validate those, because it implements the simplified
scheme. Phase 2 therefore requires a coordinated change to BOTH:

- the **encoder** — write SDM file settings (`ChangeFileSettings` with SDM enabled,
  correct SDMReadCtr/PICCData/MAC mirror offsets), and
- the backend **`validateScan` / `computeCmac`** — implement true AN12196 SDM session-key
  derivation and SDMMAC verification.

This is a known, tracked gap, not a defect in the current code. The current code is
internally consistent (encoder-side `simulateTap` ↔ verify-side `validateScan`) and is
the correct Phase-1 target.
