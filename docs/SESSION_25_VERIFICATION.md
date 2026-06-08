# Session 25 — Dispute Resolution Full Flow (Phase 7F) — Verification

**Date:** 2026-06-07
**Branch:** `feature/session-25-disputes`
**Plan:** `docs/plans/SESSION_25_PLAN.md`
**Acceptance source:** Feature Backlog → [S25](https://www.notion.so/36f3baf69664812ea054ddd2ec0d5d9c)

---

## Scope — what shipped

This is **S25 Part 1** (backend + minimal buyer UI). The full admin review interface and richer buyer appeal UX move to **S25.5** per the approved split.

| Acceptance criterion | Status | Notes |
|---|---|---|
| `settlements` extended with evidence + resolution_actions + appeal columns | ✅ | Migration `20260607000001_dispute_resolution_fields.sql` applied to staging Supabase 2026-06-07 |
| Buyer dispute submission with reason picker + multi-file S3 upload | ✅ | `DisputeSubmissionForm` component; uploads via presigned S3 PUT (max 10 files, 50 MB each, images/video/PDF) |
| Admin resolution buttons: full refund / partial refund / reject | ✅ | `POST /api/v1/admin/disputes/:settlementId/approve` now accepts `action: 'FULL_REFUND' \| 'PARTIAL_REFUND'` + optional `partial_amount_cents` |
| Real processor refund (Stripe) | ✅ | `backend/src/lib/refundClient.ts` calls `stripe.refunds.create()` directly; logs to `refunds` table |
| Real processor refund (PaymentCloud + others) | ⏭️ | Returns `UNSUPPORTED_PROCESSOR` for non-Stripe processors. Will wire when those API keys land (per `MODULE_STATUS.md`) |
| Postmark notifications on each transition | ✅ | 4 new templates (`disputeApprovedFullEmail`, `disputeApprovedPartialEmail`, `disputeRejectedEmail`, `disputeAppealOpenedEmail`) wired through `notificationService` |
| Optional 7-day appeal window | ✅ | Reject sets `appeal_deadline = now + 7d`; `POST /api/v1/settlements/:id/dispute/appeal` opens appeal until deadline |
| vitest specs for state transitions + refund mocking | ✅ | `backend/src/__tests__/disputes.test.ts` — 9 tests; full backend suite 64/64 green |
| Admin side-by-side review UI (`/admin/disputes`) | ⏭️ S25.5 | Per scope split |
| Buyer dispute history page | ⏭️ S25.5 | Per scope split |

---

## State machine (after S25)

```
ESCROW_HOLD
   │
   │ buyer POST /settlements/:id/dispute  (with evidence_urls[])
   ▼
DISPUTED ────► (admin approve FULL_REFUND)  ── Stripe refund (full amount) ──► REFUNDED
   │      ────► (admin approve PARTIAL)     ── Stripe refund (partial)     ──► REFUNDED
   │      ────► (admin reject)              ── appeal_deadline = now+7d    ──► ESCROW_HOLD
   │                                                                            │
   │                                          buyer POST /dispute/appeal (<7d) │
   ▼                                                                            ▼
                                              status=DISPUTED, resolution_action=APPEALED
                                              (admin reviews again via existing approve/reject endpoints)
```

`refunds` table receives a row on every successful Stripe refund (`processor_refund_id`, `amount_cents`, `initiated_by`).

---

## Manual smoke (curl-ready)

Staging backend: `https://vw7zy9mkyg.us-east-2.awsapprunner.com`.

Replace `<JWT>` with a buyer JWT from staging (`test@authentic-materials.com` per `CLAUDE.md`), `<SETTLEMENT_ID>` with an `ESCROW_HOLD` settlement owned by that buyer.

### 1. Get a presigned S3 upload URL

```bash
curl -X POST "$BACKEND/api/v1/settlements/$SETTLEMENT_ID/dispute/evidence" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"filename": "photo.jpg", "content_type": "image/jpeg"}'
```

Expect: `{ "success": true, "data": { "uploadUrl": "...", "publicUrl": "...", "s3Key": "disputes/..." } }`

### 2. PUT the file to S3

```bash
curl -X PUT "$UPLOAD_URL" -H "Content-Type: image/jpeg" --data-binary @photo.jpg
```

### 3. Open the dispute

```bash
curl -X POST "$BACKEND/api/v1/settlements/$SETTLEMENT_ID/dispute" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Item never arrived after 30 days...", "evidence_urls": ["'$PUBLIC_URL'"]}'
```

Expect: `{ "success": true }`. Both buyer + seller get `DISPUTE_OPENED` notifications (in-app + email).

### 4. Admin approves (partial refund)

```bash
curl -X POST "$BACKEND/api/v1/admin/disputes/$SETTLEMENT_ID/approve" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"action": "PARTIAL_REFUND", "partial_amount_cents": 2000, "notes": "Buyer accepted compromise — $20 refund."}'
```

Expect: `{ "success": true, "status": "REFUNDED", "refundId": "re_...", "refundAmountCents": 2000 }`.
Verify in Stripe Dashboard → Refunds. Both parties receive `DISPUTE_APPROVED_PARTIAL` emails.

### 5. (Alternative) Admin rejects

```bash
curl -X POST "$BACKEND/api/v1/admin/disputes/$SETTLEMENT_ID/reject" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"notes": "Evidence insufficient — see seller's tracking confirmation."}'
```

Expect: `{ "success": true, "status": "ESCROW_HOLD", "resolutionAction": "REJECTED", "appealDeadline": "..." }`.

### 6. Buyer appeals (within 7 days)

```bash
curl -X POST "$BACKEND/api/v1/settlements/$SETTLEMENT_ID/dispute/appeal" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"reason": "New evidence: ... (min 20 chars)"}'
```

Expect: `{ "success": true }`. Status returns to `DISPUTED` with `resolution_action=APPEALED`.

---

## What I verified locally

- ✅ `backend/` `tsc --noEmit` — 0 errors
- ✅ `frontend/` `tsc --noEmit` — 0 errors
- ✅ `npm test` (backend) — 64/64 passing, 21 skipped (live-server integration tests, as expected)
- ✅ Migration applied to staging Supabase project `pmlofthmobglcfkqjtru`
- ✅ Types regenerated — `evidence_urls`, `resolution_action`, `partial_refund_amount_cents`, `dispute_resolution_notes`, `processor_refund_id`, `appeal_deadline`, `appeal_opened_at`, `appeal_reason` all present in `backend/src/types/database.types.ts`

## What needs Boss to verify on staging

- [ ] Deploy backend to App Runner (`auctionX_backend_staging`) — disputes won't work without the new routes shipped
- [ ] Real Stripe sandbox test: open a dispute on a known ESCROW_HOLD settlement → admin approve PARTIAL_REFUND ($X) → confirm Stripe Dashboard shows the refund
- [ ] Confirm Postmark activity log shows the new transition emails (4 templates × 2 recipients per resolution)
- [ ] Click through the buyer UI: open `/settlements/:id` while in ESCROW_HOLD, attach 2 files, submit, verify status badge flips to DISPUTED

---

## Side-improvements landed (free)

- `backend/src/lib/s3.ts` default region `us-east-1` → `us-east-2` (TODO.md tech debt cleared)
- `notificationService.renderEmail()` dispatch table refactored to a metadata-driven helper (cleaner than the original switch)

---

## Carryover to S25.5

- `/admin/disputes` list + detail UI (side-by-side buyer evidence | seller evidence | resolution buttons)
- Buyer dispute history page
- Buyer appeal UI gets the full evidence-attachment flow (current implementation is reason-only)
- `payment_window_expiring` pg_cron trigger (still pending from main TODO)
- PaymentCloud / Signature / CCBill refund wiring when their API keys go live

---

## Files changed this session

**Created**
- `supabase/migrations/20260607000001_dispute_resolution_fields.sql`
- `backend/src/lib/refundClient.ts`
- `backend/src/__tests__/disputes.test.ts`
- `frontend/src/components/disputes/DisputeSubmissionForm.tsx`
- `docs/plans/SESSION_25_PLAN.md`

**Modified**
- `backend/src/controllers/payoutController.ts` — extended `openDispute` for evidence; added `getDisputeEvidenceUploadUrl`, `openDisputeAppeal`
- `backend/src/routes/admin/disputes.ts` — full rewrite: FULL/PARTIAL refund branches, refund client wiring, notification dispatch
- `backend/src/routes/settlements.ts` — wired new evidence + appeal endpoints
- `backend/src/lib/notifications/emailTemplates.ts` — 4 new dispute templates
- `backend/src/lib/notifications/notificationService.ts` — dispute renderer cases + new pref-map entries
- `backend/src/lib/s3.ts` — default region fix
- `backend/src/types/database.types.ts` — regen against staging
- `frontend/src/lib/api.ts` — `openDispute(evidenceUrls)`, `getDisputeEvidenceUploadUrl`, `openDisputeAppeal`
- `frontend/src/pages/SettlementPage.tsx` — replaced inline form with `DisputeSubmissionForm`; added buyer appeal block

---

**Status:** Ready for staging deploy + Boss manual E2E. S25 backend acceptance criteria all green.
