# S-NFC2 Ph2 — Physical NTAG 424 DNA Encode · Verification

**Branch:** `feature/s-nfc2-ph2-encode` → merged to `dev`
**Commits:** `2326035` (encoder + EV2 secure messaging + precheck endpoint, 2026-10-02) · `1bea0d5` (install fix + staff login, 2026-10-03)
**Date:** 2026-10-02 → 2026-10-03
**Scope:** encode a real NTAG 424 DNA chip under the staging KMS roots, enroll it, and verify a phone tap end to end
against the staging backend.

---

## Hardware run (2026-10-03)

| Step | Result | Evidence |
|---|---|---|
| Encoder identity | ✅ | `aws sts get-caller-identity --profile am-encoder` → `assumed-role/am-tag-encoder-staging/…` (MFA) |
| KMS keys reachable | ✅ | `kms describe-key` on `alias/am-tag-sdm-staging` and `alias/am-tag-admin-staging` → `["HMAC_256","GENERATE_VERIFY_MAC",true]` |
| Offline rehearsal | ✅ | `personalise --emulator --dev-roots` → encoded, read-back ctr 1 |
| Real chip `chip_001` | ✅ | audit ledger `~/.am-tag-encoder/audit.jsonl`: `mode=pcsc`, `result=encoded`, `resumed=false`, `readback_counter=1`, `key_version=1`, `tag_id=253ed5ca-7e89-4b58-b3aa-e129039e1ab9`, `2026-10-03T17:47:38Z` |
| Phone tap → backend | ✅ | `tag-encoder tapcheck --url …/verify/chip_001?picc_data=FD12…2D50&cmac=3D01…B080` → **HTTP 200** `{"valid":true,"tagId":"253ed5ca-…","counterValue":3}` |

This proves on silicon: EV2 secure messaging (AN12196 Rev 1.8), the corrected SDMAccessRights byte order (`FF 23`),
ChangeKey ordering with K0 last, NDEF written via Plain WriteData inside the authenticated session (the one assumption
that was only emulator-verified), KMS-derived per-chip keys, and backend SUN verification with counter advance.

## Test results

| Suite | Result |
|---|---|
| tag-encoder `pytest` | 166 passed |
| tag-hq `pytest` | 68 passed |
| backend `vitest` | 370 passed / 21 skipped |
| `tsc --noEmit` | 0 errors, frontend + backend |

## Fixed during the hardware run

- **Encoder not installable on a fresh checkout.** The `iam/` folder (IAM templates) made setuptools flat-layout
  discovery see three top-level packages and refuse to build. `pyproject.toml` now sets
  `[tool.setuptools.packages.find] include = ["tag_encoder*"]`.
- **Staff login** in `encoder.env.op` → 1Password `AM - Admin account` (references quoted; the name has spaces).
- **Role trust policy orphaned.** `am-tag-encoder` had been deleted and recreated after the role was created, so AWS
  had rewritten the trust principal to the dead user's unique ID (`AIDA…`). AssumeRole failed with a generic
  "not authorized". Fixed with `update-assume-role-policy` using the ARN.
- **Mac setup (not in repo):** `~/.aws/config` profiles `am-encoder-user` (`credential_process` →
  `~/.aws/op-credential-process.sh`, key read from 1Password `AWS - AM Tag Encoder`) and `am-encoder` (role + MFA).
  The terminal needed macOS Full Disk Access for the 1Password CLI app integration. Use `command aws` for manual
  checks, because the op `aws` shell-plugin alias otherwise injects the deploy key.

## Open for Boss

1. Audit ledger records tag id, not UID (the brief asked for UID; logging rules forbid raw UIDs). Confirm.
2. K1/K4 left at factory per the locked slot map, versus the brief's "change all five". Confirm.
3. Not fixed: public `GET /nfc/by-uid` logs the raw UID (`nfc_tag_viewed_by_uid`).
4. Staging CloudFront still serves the 2026-05-30 frontend, so the verify page itself is stale (S-NFC3-FE).
