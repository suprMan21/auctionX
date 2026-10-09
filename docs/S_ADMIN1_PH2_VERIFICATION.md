# S-ADMIN1 Ph2 — Re-issue queue + $10 · Verification

**Branch:** `feature/s-admin1-ph2-reissue` (from `dev` @ `7a9b101`)
**Date:** 2026-10-09
**Plan:** `docs/plans/2026-10-09-s-admin1-ph2.md`
**Backlog:** https://app.notion.com/p/3ed3baf6966481eb84abe7dc88798a4a (AC 4)

Status: **✅ LIVE and verified on silicon 2026-10-09** — real chip, real photos, sandbox $10 payment, webhook,
fulfil, phone taps. AC 4 met; all S-ADMIN1 acceptance criteria now met.

---

## What Ph2 is (decisions with Boss, 2026-10-09)

1. A re-issue replaces a chip that is **coming loose, before it falls off**, for the **registered owner**. A chip
   that has already come off is not replaced ("someone could just take the chip and say oh it fell off").
2. Proof: a **live tap** of that chip (single-use tap session, 10 min) + **1–3 photos from the web app's live
   camera** (no file picker).
3. **Pay on the website only** (emailed link + token page), never in the phone app (app store fees).
4. Approve → owner pays → **webhook** marks PAID → admin picks an enrolled chip → **Fulfil** (Ph1 reset, one
   transaction). Nothing goes through unpaid **unless an admin waives** the fee with a typed reason.
5. **Owner override dropped from Ph2.** A skipped transfer is exactly the case where AM cannot tell bought from
   stolen; the holder must get the registered owner to transfer.
6. Typed confirmation on reset/fulfil is now the **last 6 of the chip serial** (v2); v1 chips fall back to the
   UID suffix. Every chip in the lot ends in UID `…936980`.

## Test results

```
backend   npx tsc --noEmit         0 errors
backend   npx vitest run           23 files · 555 passed · 21 skipped   (baseline 498 passed · 21 skipped)
frontend  npx tsc --noEmit         0 errors
frontend  npx vitest run           9 files · 126 passed                 (baseline 100)
boundary  npm run lint:boundaries  ✔ 0 violations (143 modules)
frontend  eslint (touched dirs)    0 new problems; 5 pre-existing (AdminProtectedRoute, AdminAuditLogPage,
                                   AdminUserDetailPage, MyTokensPage, TokenVerifyPage:42 — was :45 on dev)
```

| Spec | Tests | Covers |
|---|---|---|
| `backend/src/__tests__/reissue.test.ts` (new) | 47 | owner request (owner only, tap of THIS chip and still its latest, photos under own prefix + really uploaded, 1–3, one open request, tap not spent on a refusal), evidence keys, pay (one PI, idempotency key = request id, stored before the secret, state + ownership re-checks), cancel (Stripe first, refused once paid), webhook (PAID only, replay, intent binding, cancelled request, 500 on DB failure, kinds never cross), admin approve / waive / reject / fulfil, emails (web pay link, no admin reason, no em dash), queue filter + no raw keys |
| `adminTags.test.ts` | +1 | reset confirms a v2 chip on its serial suffix, refuses the shared UID suffix |
| `schemaColumnDrift.test.ts` | +2 files | `adminReissueController.ts`, `reissueEmails.ts` |
| `routeAllowlist.test.ts` | +1 | `/api/v1/admin/reissue-requests` stays mounted with the marketplace parked |
| `tagManagementRoutes.test.ts` | +4 routes | photo-url, mine, pay, cancel mounted and behind auth |
| `frontend/.../tokens/pages/reissue.test.tsx` (new) | 18 | request page (tap first, wrong chip, live camera only, attached confirmation, 3-photo cap, expired tap message, open request, not owner), pay page (fee, Stripe confirm, waits for webhook, decline, under review, not found, failed redirect), token-page section (pay link, cancel, no cancel once paid), verify-page entry (owner + live tap only) |
| `frontend/.../admin/pages/adminReissue.test.tsx` (new) | 8 | queue (chip, tap, photos), approve / waive / reject need a reason, ownership warning, no fulfil while unpaid, fulfil needs serial suffix (shared UID suffix refused), server error keeps dialog open |

**Guards proven to fire** (broken on purpose, a test failed, restored):
backend — owner check, tap counter check, photo prefix check, webhook intent binding, fulfil confirmation,
pay state check, PI stored before secret; frontend — chip confirmation, tap must be this chip, "still attached"
box.

## Live database checks (staging, rolled back)

`supabase/tests/s_admin1_ph2_live.sql` runs every check inside one `DO` block that ends by raising its results,
so **nothing persists** (confirmed after the run: 0 seed tags, 0 requests, constraints unchanged).

| # | Check | Result |
|---|---|---|
| 01 | non-admin actor → `42501 admin_forbidden` | ✅ |
| 02 | short reason refused | ✅ |
| 03 | approve refused when requester no longer owns the token | ✅ |
| 04 | approve → APPROVED + AWAITING_PAYMENT, `reissue_approve` audit row | ✅ |
| 05 | second decision refused | ✅ |
| 06 | fulfil while unpaid → `not_paid` | ✅ |
| 07 | table CHECK: fulfilled but AWAITING_PAYMENT refused | ✅ |
| 07b | table CHECK: fulfilled with NULL payment state refused | ❌ before M2 → ✅ after M2 pushed |
| 08 | table CHECK: WAIVED with no reason refused | ❌ before M2 → ✅ after M2 pushed |
| 09 | one open request per tag | ✅ |
| 10 | **atomicity:** fulfil forced to fail at its LAST statement → both tags, request, custody row, proof and the reset's audit row all unchanged | ✅ |
| 11 | fulfil → old RETIRED / PENDING destruction / replaced_by; new ACTIVE same owner; one current proof; REISSUE custody; `tag_reset` + `reissue_fulfil` audit rows | ✅ |
| 12 | second fulfil refused | ✅ |
| 13 | reject → REJECTED, nothing to pay | ✅ |
| 14 | approve + waive → WAIVED with reason, `reissue_approve_waived` audit | ✅ |
| 15 | waive without approve refused | ✅ |
| 16 | only service_role can execute either function | ✅ |
| 17 | new audit rows are append-only | ✅ |

**Bug found by the live run:** a CHECK that evaluates to NULL passes. `length(btrim(NULL)) >= 10` and
`NULL IN ('PAID','WAIVED')` both let NULLs through. M2 `20261009000002_s_admin1_reissue_check_nulls.sql` wraps
both in `coalesce`. Proven first inside a rolled-back run, then for real: Boss pushed M2 2026-10-09 and the
live check re-ran **19/19 ok** against the staging schema (0 leftover rows).

## Corrections to the plan

- The plan reused `PaymentForm.tsx`; it is the legacy marketplace form (no clientSecret). The pay page copies the
  transfer flow's own payment step instead.
- The plan put owner override in Ph2; dropped (decision 5).
- The S3 media bucket is publicly readable by path (`PublicReadGetObject`), so evidence goes in its own private
  bucket: `infra/s3/reissue-evidence-staging/`.

## Live run on silicon (staging, 2026-10-09) — ✅

Request `5391a018-4abf-49f2-be77-62994f6fc3c7`. Spare chip encoded as `chip_004` (v2, serial `…8A0351DE`, tag
`7c9960df…`, enrolled 06:34Z).

| Step | Time (UTC) | Result |
|---|---|---|
| test2@ taps `chip_003`, 3 live-camera photos uploaded | 06:49:07–08 | ✅ 3 presigned PUTs; keys under test2@'s own prefix in the private bucket |
| Request filed | 06:49:09 | ✅ PENDING, $10 snapshot, tap session consumed `reissue_request` by test2@ |
| Boss approves | 06:50:01 | ✅ `reissue_approve` audit row with reason; "approved — pay on the website" email (Postmark accepted) |
| test2@ pays from the web pay page | 06:50:16 | ✅ one PaymentIntent `pi_3UOXdED8X…` |
| Stripe webhook `token_reissue_fee` | 06:51:07 | ✅ AWAITING_PAYMENT → PAID; "payment received" email |
| Boss fulfils onto `chip_004` (serial-suffix confirmation) | 06:52:52 | ✅ `tag_reset` + `reissue_fulfil` audit rows, same transaction timestamp; "replacement active" email |
| End state | — | `chip_003` RETIRED, destruction PENDING, replaced_by → `chip_004`, old proof `stale`; `chip_004` ACTIVE test2@, one `current` proof, REISSUE custody row; `chip_001` untouched (ACTIVE, test2@) |
| Phone taps (Boss) | — | ✅ `chip_003` reads retired; `chip_004` opens test2@'s token |

## Problems found during the live run (all fixed)

1. **CHECK constraints that evaluate to NULL pass.** M1's waive-reason and fulfil-paid CHECKs let NULLs through.
   Found by the rolled-back live check; fixed by M2 (`coalesce`), 19/19 after Boss pushed it.
2. **Silent 500.** The first two real photo uploads returned "Internal server error" and left no log line: the
   token routes' error wrapper (`routes/tagManagement.ts` `handle`) never logged non-AppErrors. It now logs
   `unhandled_route_error` (route pattern, request id, error name + message; never the body). Commit `7ce0e27`.
3. **Root cause of the 500: App Runner has `AWS_ACCESS_KEY_ID` but no `AWS_SECRET_ACCESS_KEY`**, so the S3 client
   got an undefined secret. Fix: the evidence client uses static keys only when both are set, otherwise the default
   chain; Boss attached `ReissueEvidenceStaging` to the App Runner **instance role** `am-backend-staging-instance`.
   No long-lived secret. (The policy was first put on IAM user `auctionx-s3-access`, which App Runner cannot use.)
4. **Presigned PUT would have been rejected by S3:** newer AWS SDKs sign a CRC32 of the (empty) body into presigned
   URLs. Fixed with `requestChecksumCalculation: 'WHEN_REQUIRED'`; test asserts no checksum params and that
   content-type + content-length are signed. Commit `7ce0e27`.
5. **Deploys:** pushes to `dev` did not reliably start an App Runner deployment (no push-triggered deploy between
   10-06 and 02:25 tonight; the 02:43 one did trigger). Settings saves (`UPDATE_SERVICE`) do not pick up new code
   reliably. Check with `claude-ro` `list-operations` + an unauthenticated route probe before testing.

## Follow-ups

- **Encoder auto-naming** (Boss, 2026-10-09, option 1): when `--item` is omitted, name the chip `chip_NNN` (next in
  sequence), with a backend uniqueness check BEFORE any chip write.
- Optional: remove `ReissueEvidenceStaging` from IAM user `auctionx-s3-access` (unused).
- `chip_003` is RETIRED / destruction PENDING (keep or destroy at Boss's discretion); `chip_002` likewise.
- `claude-ro` cannot read the evidence bucket's settings (only the media bucket's).
