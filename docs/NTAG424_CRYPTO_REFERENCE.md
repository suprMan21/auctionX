# NTAG 424 DNA — Crypto Reference (AN12196 SDM, S-NFC3.5)

> **Status (2026-10-01, S-NFC3.5):** the encoder, the backend verifier and the
> Tag HQ parser now implement **real NXP AN12196 Secure Dynamic Messaging, AES
> mode**. The Phase-1 "simplified CMAC" (MAC over the ciphertext under a static
> per-tag key) has been **deleted** from all three. The previous "Known Gap"
> section is closed — see §8.
>
> Out of scope: LRP mode, physical encode over a live EV2 channel (S-NFC2
> Phase 2), mobile, frontend.

---

## 1. Authoritative sources in this repo

| Concern | Backend (TS) | Encoder (Python) |
|---|---|---|
| PICCDataTag parse | `backend/src/services/nfc/ntag424Codec.ts:40` `parsePiccDataTag` | `tag-encoder/tag_encoder/ntag424/encode.py:68` `parse_picc_data_tag` |
| PICCData decrypt + parse | `ntag424Codec.ts:83` `decryptPiccBlock`, `:89` `decryptPiccData` | `encode.py:105` `decrypt_picc_block`, `:109` `decrypt_picc_data` |
| PICCData encode (simulator) | `ntag424Codec.ts:95` `buildPiccPlaintext`, `:107` `encryptPiccBlock` | `encode.py:83` `build_picc_plaintext`, `:99` `encrypt_picc_block` |
| AES-CMAC (RFC 4493) | `ntag424Codec.ts:138` `aesCmac` | `tag-encoder/tag_encoder/aes.py` `aes128_cmac` |
| SV2 / session MAC key | `ntag424Codec.ts:165` `buildSv2`, `:171` `deriveSessionMacKey` | `encode.py:120` `build_sv2`, `:124` `session_mac_key` |
| Truncation (even bytes) | `ntag424Codec.ts:175` `truncateSdmMac` | `encode.py:129` `truncate_sdm_mac` |
| MAC input range | `ntag424Codec.ts:183` `extractMacInput` | `encode.py:136` `extract_mac_input` |
| Constant-time verify | `ntag424Codec.ts:218` `verifySdmMac` (`timingSafeEqual`) | `encode.py:151` `verify_sdm_mac` (`hmac.compare_digest`) |
| Full verify pipeline | `backend/src/services/nfc/ntag424.ts:96` `validateSunScan` | `encode.py:269` `verify_sun` |
| Tap simulation | `backend/src/services/nfc/ntag424Simulator.ts:40` `simulateTap` | `encode.py:237` `encode_sun` |
| Chip-key KDF | `backend/src/services/nfc/keys/keyDerivation.ts:61` `kdfMessage`, `:78` `hkdfExpand` | `tag-encoder/tag_encoder/keyprovider.py:57` `kdf_message`, `:66` `hkdf_expand` |
| Key providers | `backend/src/services/nfc/keys/tagKeyProvider.ts:85` KMS, `:130` local | `tag-encoder/providers/kms_key_provider.py:62` KMS, `keyprovider.py:91` local |
| SDM file settings (write) | — | `tag-encoder/tag_encoder/ntag424/apdu.py` `sdm_file_settings_payload` |
| SDM file settings (read) | — | `tag-hq/tag_hq/parsers.py` `parse_file_settings` / `parse_sdm_settings` |

**Single shared vector file:** `test-vectors/ntag424_sdm_vectors.json`, generated
by `test-vectors/generate_ntag424_vectors.py` with the **openssl binary as the
oracle** (never our code). Loaded by backend vitest (`ntag424Sdm.test.ts`,
`nfcKeyProvider.test.ts`), tag-encoder pytest (`test_sdm_vectors.py`,
`providers/test_kms_key_provider.py`) and tag-hq pytest (`test_sdm_parsing.py`).

---

## 2. Keys and slots

| Slot | Role | Scope | Root | Who derives it |
|---|---|---|---|---|
| K0 | `APP_MASTER` | per UID | **ADMIN** root (`alias/am-tag-admin-staging`) | encoder only |
| K1 | reserved | — | — | — |
| K2 | `META` = SDMMetaReadKey | fleet-wide, versioned | **SDM** root (`alias/am-tag-sdm-staging`) | backend + encoder |
| K3 | `FILE` = SDMFileReadKey | per UID, versioned | **SDM** root | backend + encoder |
| K4 | reserved | — | — | — |

Two HMAC_256 KMS roots per environment, separated by role (amended 2026-10-01
by Boss: KMS cannot restrict `GenerateMac` by message content, so role
separation must be root separation). Production gets its own `-prod` pair.

KDF (identical in TS and Python):

```
msg = "AM-NTAG424-KDF" || 00 || role_ascii || 00 || version(1 byte) || uid(0 or 7 bytes)
prk = HMAC-SHA256(root, msg)          # KMS GenerateMac (HMAC_SHA_256) or local HMAC
key = HKDF-Expand(prk, info = "NTAG424-DNA/" || role || "/AES128/v" || version, L = 16)
```

The key version is recorded per chip in `nfc_tags.sdm_key_version` so a rotated
META key still serves older chips. Derived keys are never cached, stored,
logged or printed.

---

## 3. PICCData (encrypted, under SDMMetaReadKey)

```
ENCPICCData (16 B, in the URL as 32 hex)  = AES-128-CBC-encrypt(SDMMetaReadKey, IV = 0, PICCData)
PICCData = PICCDataTag(1) || UID(7) || SDMReadCtr(3, little-endian) || padding(5, random on silicon)

PICCDataTag  bit7 = UID mirrored
             bit6 = SDMReadCtr mirrored
             bits3..0 = UID length (7)
```

We parse the tag byte rather than asserting `0xC7`, and reject anything that
does not mirror BOTH a 7-byte UID and the counter. Correction to the old doc:
PICCData is encrypted under the SDMMetaReadKey directly with a zero IV — not
under a counter-derived session ENC key (that key, `SesSDMFileReadENCKey`,
applies only to SDMENCFileData, which we do not use).

## 4. SDMMAC (under the per-UID SDMFileReadKey)

```
SV2                = 3C C3 00 01 00 80 || UID(7) || SDMReadCtr(3, LE as on the wire)
KSesSDMFileReadMAC = AES-CMAC(SDMFileReadKey, SV2)
SDMMAC (16 B)      = AES-CMAC(KSesSDMFileReadMAC, file[SDMMACInputOffset : SDMMACOffset])
on the wire (8 B)  = SDMMAC bytes at indices 1,3,5,...,15  ("even-numbered" bytes)
```

Our URL layout has no SDMENCFileData and `SDMMACInputOffset == SDMMACOffset`,
so the MAC input is the **empty string** (RFC 4493 empty-message CMAC). The
general range is implemented and tested with a non-empty vector.

## 5. Verify order (both stacks)

1. Parse `picc_data`/`e` (32 hex) and `cmac`/`c` (16 hex) → else `malformed`.
2. Derive META(version) → decrypt → parse PICCDataTag → else `invalid_signature`.
3. If the request names a chip, decrypted UID must match → else `uid_mismatch`
   (surfaced to API callers as `invalid_signature`).
4. Derive FILE(version, UID) → SDMMAC, **constant-time** compare → else `invalid_signature`.
5. Counter must be strictly greater than `nfc_tags.sun_counter` → else `replay_detected`.
6. Burn the counter with a conditional update
   `.update({sun_counter: n}).eq('id', id).lt('sun_counter', n).select('id')`;
   zero rows → `replay_detected` (a concurrent request won).

The public scan identifies the chip by **one** META decrypt per live key
version (current first): PICCData → UID → row. No trial decryption across tags.

## 6. NDEF layout and SDM file settings

URL: `https://<host>/verify/<token>?picc_data=<32 hex>&cmac=<16 hex>`.
The encoder writes the file with ASCII `0` placeholders and computes the offsets
from the template (`encode.py:188` `build_sdm_template`); offsets count from the
start of the NDEF file including NLEN.

ChangeFileSettings cleartext body (`apdu.py` `sdm_file_settings_payload`):

| Field | Value | Meaning |
|---|---|---|
| FileOption | `40` | SDM on, CommMode Plain (any phone can read) |
| AccessRights | `00 E0` | 0xE000 LSB first: Read=E (free), Write=K0, RW=K0, Change=K0 |
| SDMOptions | `C1` | UID mirror, SDMReadCtr mirror, ASCII |
| SDMAccessRights | `23 FF` | 0xFF23 LSB first: RFU=F, CtrRet=F, **MetaRead=K2**, FileRead=K3 |
| PICCDataOffset | 3 B LE | present because MetaRead is a key (encrypted PICCData) |
| SDMMACInputOffset | 3 B LE | == SDMMACOffset |
| SDMMACOffset | 3 B LE | |

S-NFC2 shipped `SDMMetaRead = 0xE` (plain UID/counter mirror); that is now
rejected by the builder. Tag HQ decodes the same block from GetFileSettings and
flags a plain mirror.

## 7. Golden vector #1 (AN12196, all-zero keys)

```
e   = EF963FF7828658A599F3041510671E88
PICCData = C7 04DE5F1EACC040 3D0000 DA5CF60941   -> UID 04DE5F1EACC040, ctr 61
SV2 = 3CC30001008004DE5F1EACC0403D0000
KSesSDMFileReadMAC = 3FB5F6E3A807A03D5E3570ACE393776F
CMAC(empty)        = E194C7EE12D9F7EE8A65C8331B704386
c   = 94EED9EE65337086
```

Reproduced byte for byte by OpenSSL, the backend and the encoder.

## 8. Known gaps — closed / remaining

| Former gap | Status |
|---|---|
| CMAC over ciphertext with the raw key | **Closed** — session MAC key from SV2, MAC over the SDM input range |
| PICCData key / IV | **Closed** — SDMMetaReadKey, zero IV (old doc's session-ENC claim was wrong) |
| Fixed `0xC7` header assert | **Closed** — PICCDataTag parsed |
| First-8-bytes truncation | **Closed** — even-numbered bytes |
| Non-constant-time compare | **Closed** |
| Plain UID/ctr mirror in ChangeFileSettings | **Closed** — encrypted PICCData, explicit slots |

Remaining (out of scope here): live EV2 secure channel for ChangeKey /
ChangeFileSettings / WriteData (S-NFC2 Phase 2), LRP mode, SDMENCFileData.
