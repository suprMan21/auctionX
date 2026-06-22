# NDEF / SUN URL Message Format

> The exact on-tag byte layout the S-NFC2 encoder must write into the NDEF file (file
> `E104` / file no `0x02`), and the URL template the backend verify path parses. This
> document matches the parser in `tag-hq/tag_hq/parsers.py` byte-for-byte and the URL
> builder in `backend/src/services/nfc/ntag424Simulator.ts`.

---

## 1. The SUN URL template

The mirror URL written into the tag, built by `buildSunUrl`
(`backend/src/services/nfc/ntag424Simulator.ts:30-39`):

```
{baseUrl}/verify/{tokenName}?picc_data={32 hex}&cmac={16 hex}
```

Rules from `buildSunUrl`:

- `baseUrl` has any trailing slash stripped (`.replace(/\/$/, '')`,
  `ntag424Simulator.ts:36`).
- `tokenName` is URL-encoded via `encodeURIComponent` (`ntag424Simulator.ts:38`).
- query string is built with `URLSearchParams({ picc_data, cmac })`
  (`ntag424Simulator.ts:37`) — so the param order is `picc_data` then `cmac`, and
  values are percent-encoded (the hex values need no encoding).
- `picc_data` = 32 uppercase hex chars (16-byte encrypted PICC block).
- `cmac` = 16 uppercase hex chars (first 8 bytes of the AES-CMAC).

Worked example:

```
baseUrl   = https://authentic-materials.com
tokenName = AM-00042
picc_data = A1B2C3D4E5F60718293A4B5C6D7E8F90   (32 hex)
cmac      = 0011223344556677                   (16 hex)

→ https://authentic-materials.com/verify/AM-00042?picc_data=A1B2C3D4E5F60718293A4B5C6D7E8F90&cmac=0011223344556677
```

### Verify-side parsing

`parseSunMessage` (`backend/src/services/nfc/ntag424.ts:8-19`) reads the params with a
fallback to short aliases:

- `picc_data` (or `e`) → `encPiccData`
- `cmac` (or `c`) → `cmac`

If either is missing it returns `null` (treated as "invalid SUN format"). The encoder
should always write the long form (`picc_data` / `cmac`).

---

## 2. NDEF file layout — NLEN wrap + URI record

The NDEF file (`E104`) holds a **2-byte big-endian NLEN** followed by the NDEF message.
This is exactly what `parse_ndef` expects (`tag-hq/tag_hq/parsers.py:200-225`):

```
offset  bytes  field
------  -----  ----------------------------------------------
0..1    2      NLEN          length of the NDEF message, big-endian
2..     NLEN   NDEF message  a single well-known URI ('U') record
```

`NLEN = int.from_bytes(data[0:2], "big")` (`parsers.py:204`); the message is
`data[2 : 2+nlen]` (`parsers.py:205`).

### The single URI record

`parse_ndef` accepts a single well-known URI record and validates
(`parsers.py:209`): `(msg[0] & 0x07) == 0x01` (TNF = Well Known) and `msg[1] == 0x01`
(type length = 1). It then reads (`parsers.py:211-214`):

```
msg[0]                 header byte:  MB|ME|CF|SR|IL | TNF(3 bits) — TNF must be 0x01
msg[1]                 TYPE LENGTH   = 0x01
msg[2]                 PAYLOAD LENGTH (short record, 1 byte)
msg[3 .. 3+typelen]    TYPE          = 'U' (0x55)
msg[3+typelen ..]      PAYLOAD       = [URI prefix byte] + URI body bytes
```

For a single short record, the canonical header byte is `0xD1`
(MB=1, ME=1, SR=1, TNF=0x01). The payload's first byte is the **URI identifier code**
(prefix abbreviation); the rest is the UTF-8 URI body.

### URI prefix codes

`parse_ndef` resolves the prefix via `_URI_PREFIXES` (`parsers.py:194-197`). The encoder
uses **`0x04` = `https://`**, then appends the URL *without* the `https://` scheme:

```
0x00 = (none)        0x01 = http://www.    0x02 = https://www.
0x03 = http://       0x04 = https://       0x05 = tel:    0x06 = mailto:
```

So for `https://authentic-materials.com/verify/...`, the payload is
`0x04` followed by the UTF-8 bytes of `authentic-materials.com/verify/...`.

`parse_ndef` reconstructs the full URI as `prefix + payload[1:].decode("utf-8")`
(`parsers.py:216-217`).

### SDM/SUN mirror detection

After decoding, `parse_ndef` flags the record as an SDM/SUN mirror if the URL contains
any of `picc_data`, `enc=`, `cmac=`, `&e=`, `&c=`, `uid=`, `ctr=`
(`parsers.py:220-222`). Our SUN URLs contain `picc_data` and `cmac`, so they are
correctly detected as SUN mirrors.

---

## 3. Worked byte-level example

URI to encode (after the `0x04` `https://` prefix strips the scheme):

```
authentic-materials.com/verify/AM-00042?picc_data=A1B2C3D4E5F60718293A4B5C6D7E8F90&cmac=0011223344556677
```

URI body length (bytes after the prefix byte) — count the characters above = **103 bytes**.
Payload = prefix byte + body = `1 + 103` = **104 bytes** (`0x68`).

NDEF record (short record, single 'U' record):

```
D1            header: MB=1 ME=1 SR=1 TNF=0x01 (Well Known)
01            TYPE LENGTH = 1
68            PAYLOAD LENGTH = 104
55            TYPE = 'U'
04            URI prefix code = https://
61 75 74 ...  URI body bytes: "authentic-materials.com/verify/AM-00042?picc_data=…"
```

Record total = `4 (header+lengths+type) + 104 (payload)` = **108 bytes** (`0x6C`).

NDEF file content = NLEN wrap + record:

```
00 6C         NLEN = 108 (big-endian)
D1 01 68 55 04 61 75 74 …   the 108-byte NDEF record
```

(NLEN counts only the NDEF message bytes, not the 2-byte NLEN field itself —
`parsers.py:204-205`.)

### Read-back assertion

After `WriteData` (see `S-NFC2_ENCODER_SPEC.md` §5), the encoder reads the NDEF file
back and runs the equivalent of `parse_ndef` to confirm:

1. `NLEN` matches the written message length,
2. the URI decodes to the exact SUN URL written,
3. `is_sdm_mirror` is `True` (i.e. `picc_data` + `cmac` present).

Only then is the tag marked encoded.
