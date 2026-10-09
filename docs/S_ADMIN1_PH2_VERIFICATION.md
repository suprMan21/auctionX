# S-ADMIN1 Ph2 — Re-issue queue + $10 · Verification

**Branch:** `feature/s-admin1-ph2-reissue` (from `dev` @ `7a9b101`)
**Date:** 2026-10-09
**Plan:** `docs/plans/2026-10-09-s-admin1-ph2.md`
**Backlog:** https://app.notion.com/p/3ed3baf6966481eb84abe7dc88798a4a (AC 4)

Status: **code complete and tested; live money run and silicon run still to do** (needs the evidence bucket,
the second migration and a deploy — see "Boss actions").

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
| 07b | table CHECK: fulfilled with NULL payment state refused | ❌ → **fixed by M2** (✅ with M2 applied in-run) |
| 08 | table CHECK: WAIVED with no reason refused | ❌ → **fixed by M2** (✅ with M2 applied in-run) |
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
both in `coalesce`. Proven by applying M2 inside the rolled-back run: all 19 checks ok.

## Corrections to the plan

- The plan reused `PaymentForm.tsx`; it is the legacy marketplace form (no clientSecret). The pay page copies the
  transfer flow's own payment step instead.
- The plan put owner override in Ph2; dropped (decision 5).
- The S3 media bucket is publicly readable by path (`PublicReadGetObject`), so evidence goes in its own private
  bucket: `infra/s3/reissue-evidence-staging/`.

## Boss actions (in order)

1. **Push M2:** `supabase db push --linked` (only `20261009000002` pending). Then Claude re-runs the live check.
2. **Evidence bucket:** follow `infra/s3/reissue-evidence-staging/README.md` (bucket, policy, **CORS**, lifecycle,
   backend IAM inline policy, `REISSUE_EVIDENCE_BUCKET` env on App Runner).
3. **Push the branch** / merge to `dev` → App Runner deploy; frontend build + sync (grep `dist/assets` for `pk_test_`).
4. **Live run:** encode a spare chip (v2), tap `chip_003` as test2@ → "Chip coming loose?" → photos → submit;
   approve in `/admin/reissue-requests`; pay $10 in the sandbox from the email link; confirm PAID; Fulfil onto the
   spare with the serial suffix; tap both chips (old reads retired, new opens test2@'s token). Never `chip_001`.
