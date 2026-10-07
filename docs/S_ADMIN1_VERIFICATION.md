# S-ADMIN1 Ph1 — Token Admin Console · Verification

**Branch:** `feature/s-admin1-token-admin` (fast-forwarded into `dev`, commit `fd43206`)
**Date:** 2026-10-05
**Plan:** `docs/plans/2026-10-05-s-admin1.md`
**Backlog:** https://app.notion.com/p/3ed3baf6966481eb84abe7dc88798a4a

Phase 1 of 3. Ph2 = re-issue queue + $10 charge + owner override. Ph3 = stuck-payment queue,
sweep, GitHub Issues, admin pricing + vouchers (Boss 2026-10-05: S-ADMIN1, not S-ADMIN2).

---

## Test results

```
backend   npx tsc --noEmit         0 errors
backend   npx vitest run           21 files · 457 passed · 21 skipped   (baseline 428 passed · 21 skipped)
frontend  npx tsc --noEmit         0 errors
frontend  npx vitest run           7 files · 100 passed                 (baseline 91)
boundary  npm run lint:boundaries  ✔ 0 violations (137 modules, 384 dependencies cruised)
```

Skip count unchanged. The lint cruised 137 modules, not 0.

| Spec | Tests | Covers |
|---|---|---|
| `backend/src/__tests__/adminTags.test.ts` (new) | 28 | manage_nfc router gate, list filters, detail redaction (AC8), suspend/unsuspend, reset: typed confirmation, mint-before-DB, DB error mapping, generic internal errors |
| `tagLifecycle.test.ts` | +4 / −6 | manage_nfc gate on enroll (legacy users.role admin, role without manage_nfc, inactive admin, lookup failure); old replace tests removed |
| `schemaColumnDrift.test.ts` | +2 | now covers `adminTagController.ts` + `lib/admin/tokenAdmin.ts`; parser accepts `.select(cols, { count })` |
| `routeAllowlist.test.ts` | +1 | `/api/v1/admin/tags` stays mounted with the marketplace parked |
| `frontend/src/features/admin/pages/adminTags.test.tsx` (new) | 9 | list + links, status filter, error state, actions per state, no actions on RETIRED, reason gating, focus + Escape, reset confirmation gating, error keeps dialog open |

**Tests proven to fire** (code broken on purpose, test failed, code restored):
- removed the reset UID-suffix check → 1 backend test failed
- leaked `aes_key_enc` into the admin tag shape → 2 backend tests failed
- added a fake column to the constant and to a literal `.select()` → drift test named both
- frontend reset button ignoring the confirmation → 1 frontend test failed

---

## Live database verification (staging, 2026-10-05)

Two **test rows** (`metadata.test = 's-admin1'`), never a real chip:
A = `ef0feba0-f487-4a6e-894f-272645c33ab6` (seeded ACTIVE, owner test@), B = `d8f1986a-78c7-43a0-8036-5db658526fe9` (seeded ENROLLED).
They remain in staging (A is RETIRED and frozen by design; its audit rows are append-only).

| # | Check | Result |
|---|---|---|
| 1 | **AC1 atomicity:** `admin_reset_token` forced to fail at its LAST statement (ownership_id format CHECK), after both tag UPDATEs and the custody INSERT | ✅ A still ACTIVE with owner, B still ENROLLED, no custody row |
| 2 | Non-admin actor (test@) via service key | ✅ `42501 admin_forbidden: actor lacks manage_nfc` |
| 3 | Suspend → suspend again → unsuspend | ✅ SUSPENDED with reason; second suspend refused (`invalid_state`); back to ACTIVE |
| 4 | Reset A → B | ✅ B ACTIVE with owner; A RETIRED, `destruction_status=PENDING`, `replaced_by_tag_id=B`; REISSUE/COMPLETED custody row; exactly one current proof on B |
| 5 | **AC6 retired freeze:** set A ACTIVE; give A an owner; reset A again | ✅ all refused (`tag_retired`, `old_tag_invalid_state`); `destruction_status → DESTROYED` still allowed |
| 6 | **AC7 append-only:** UPDATE and DELETE on A's audit rows | ✅ both refused (`42501 audit_logs is append-only`); 3 rows: tag_suspend, tag_unsuspend, tag_reset |
| 7 | Publishable key → all three functions | ✅ `42501 permission denied for function …` |
| 8 | Roles after M2 | ✅ super_admin + new `admin` role both carry `manage_nfc` |

---

## Acceptance criteria (Feature Backlog S-ADMIN1)

| AC | Status |
|---|---|
| 1 Reset is one transaction | ✅ live check 1 |
| 2 admin + manage_nfc + typed reason + confirmation; non-admins 403 | ✅ router test, enroll gate tests, live check 2 |
| 3 Owner self-serve `/replace` removed | ✅ `/nfc/replace` → 410; no client calls it (grep) |
| 4 Re-issue approval charges $10 once | ⏭ Ph2 |
| 5 Suspended tags verify invalid (`suspended`); unsuspend restores; counter untouched | ✅ DB side live (check 3); verify path already maps SUSPENDED → `token_suspended` (`tagManagementController.ts` terminalStateError) — phone tap check pending deploy |
| 6 Retired chips cannot be re-enrolled/claimed/re-personalised | ✅ DB trigger (check 5) + encoder precheck refuses RETIRED |
| 7 Every admin action → audit row + security event; audit append-only | ✅ audit inside the DB functions (check 6); `admin.tag_action` event (backend tests) |
| 8 Admin views never expose keys, salts, Receipts | ✅ backend redaction test (UID reduced to 6-char suffix; no key, salt, Ownership ID, email, IP, UA, SUN message) |
| 9 tsc, vitest, boundary lint green; design system | ✅ above; dark/glass, focus-trapped dialogs, labelled controls |

---

## Corrections to the plan / brief

- The plan said M2 would seed `admin_users` for the encoder. Not needed: the encoder logs in as
  Boss's account, already an active super_admin `admin_users` row; M2 only adds `manage_nfc` to that role.
- Security events for the tag-detail view remain stdout-only (deferred, Boss 2026-10-05).
- `supabase gen types --linked` does NOT take `--password` (the CLI memory note implied it might).

## Deploy

- Backend: Boss pushed `dev` (`fd43206`); App Runner deploy `f7bc0043` SUCCEEDED (watched with `claude-ro`).
  Live probes without a token: `GET /admin/tags` 401, `POST /admin/tags/:id/reset` 401, `POST /nfc/replace` 401
  (requireAuth runs first; an authenticated caller gets 410), `GET /nfc/enroll/precheck/:uid` 401, `/health` 200.
- Frontend: Boss deploying at close-out (build + S3 sync + invalidation). Smoke: `/admin/tags`, open test row
  `…0036B2`, Suspend → Lift suspension, audit rows appear. Do NOT reset `chip_001`.

## Physical reset test — BLOCKED (duplicate-UID chips)

> **⚠️ Correction 2026-10-07 (S-NFC-ID):** the duplicate-UID finding below is WRONG. The UIDs were compared by
> their last six hex characters only. A full-UID survey found five chips with five different UIDs ending
> `…936980` (e.g. chip_001 `04A27E02936980`, chip_002 `04927E02936980`). The "refused by precheck" step was
> inferred, never observed. See `docs/S_NFC_ID_VERIFICATION.md`. The text below is kept as the original record.

The planned live reset `chip_001` → `chip_002` did not run. Fingerprinting each chip alone on the ACR1252:

| Chip | UID (GetVersion) | Read_Sig SHA-256 | NXP originality | File 02 settings | NDEF |
|---|---|---|---|---|---|
| `chip_001` (tag `253ed5ca`) | …936980 | `1d22f42aa70e…` | valid | `00 40 00 E0 …` (SDM on) | 115 B, `…/verify/chip_001?picc_data=…&cmac=…` |
| blank "third" token | …936980 | `f9f96eb88853…` | valid | `00 00 E0 EE 00 01 00` (factory) | empty |

Two physical chips, one UID, two DIFFERENT valid NXP signatures (different `r`, so not ECDSA malleability).
The blank chip cannot be enrolled (UID unique in `nfc_tags`; the encoder precheck refuses it), so no replacement
chip exists. Boss's "second" token also only ever read as …936980 (which physical chip answered is unconfirmed).

Consequences logged 2026-10-06: Lessons DB (Critical), Decisions DB **Proposed** KDF v2 / per-chip serial
identity (amends the Locked tag-key-derivation decision), Ideas DB (serial identity; signature fingerprint at
enroll). Until resolved: do not encode chips from this batch; ask the supplier.

The reset itself is proven at the database level (live check 4) and through the API tests; only the
phone-tap confirmation on real silicon is outstanding.

## Carried forward

- Physical reset + phone taps (needs a chip with a unique UID).
- AC5 phone tap of a suspended token (verify page should say on hold / invalid).
- Two pre-existing frontend lint errors (`AdminProtectedRoute.tsx:28`, `AdminAuditLogPage.tsx:108`, React 19
  set-state-in-effect) — untouched.
- Test rows A/B stay in staging (labelled `metadata.test = 's-admin1'`).
