# Session 25 — Dispute Resolution Full Flow (Phase 7F) — Plan

**Status:** DRAFT — awaiting Boss approval before any code is written
**Roadmap:** Wave 2 core loop, parallel with S24 (no vendor gate)
**Builds on:** Phase 3.75 / Session E (`POST /admin/disputes/:settlementId/approve|reject`)
**Feature Backlog:** [Notion S25 page](https://www.notion.so/36f3baf69664812ea054ddd2ec0d5d9c)

---

## Objective

Complete the dispute resolution loop: buyer can submit evidence files with a dispute, admin reviews buyer + seller evidence side-by-side, admin chooses **full refund / partial refund / reject**, and the chosen action triggers a real Stripe refund (where applicable) plus Postmark notifications to both parties. Optional 7-day appeal window.

---

## Scope split — proposing 2 sub-sessions

This is too large for one Claude session if I include both backend wiring and the full admin/buyer UIs. Recommendation:

- **S25 (this session) — backend, schema, refund wiring, notifications, vitest specs** — ends with curl-testable endpoints + a tiny buyer "open dispute with files" form (already partly built) + admin actions wired through API client. No full admin review UI yet.
- **S25.5 (follow-on)** — admin side-by-side review interface + buyer dispute history + buyer appeal UI. Pure frontend; depends on S25 endpoints being live.

Boss can override and ask for one big session if preferred — flagging it as a checkpoint.

---

## Files

### Create

| Path | Purpose |
|---|---|
| `supabase/migrations/20260607000001_dispute_resolution_fields.sql` | Add optional columns to `settlements` |
| `backend/src/controllers/disputeController.ts` | Consolidates buyer-side dispute logic (open + evidence upload + appeal). Mirrors the existing `payoutController.openDispute` but splits out cleanly. |
| `backend/src/routes/disputes.ts` | Buyer-facing dispute routes (`/api/v1/disputes/...`) |
| `backend/src/lib/refundClient.ts` | Backend → Stripe refund helper. Wraps `stripe.refunds.create({ payment_intent, amount })`. Only Stripe for now (PaymentCloud/Signature/CCBill flagged as TODO with concrete TODO(S25.5)). |
| `backend/src/lib/notifications/disputeEmails.ts` | Postmark templates + send helpers for 4 transitions: opened, approved (full refund), approved (partial refund), rejected, appeal-opened |
| `backend/src/__tests__/disputeController.spec.ts` | vitest: state-transition matrix + refund mock |
| `backend/src/__tests__/adminDisputes.spec.ts` | vitest: approve/reject/partial with refund mock + Postmark mock |
| `frontend/src/components/disputes/DisputeSubmissionForm.tsx` | Buyer form: reason picker + multi-file S3 upload (reuses existing `useS3Upload` hook from listings) |

### Modify

| Path | Change |
|---|---|
| `backend/src/routes/admin/disputes.ts` | Extend approve to accept `action: "FULL_REFUND" \| "PARTIAL_REFUND"` + `partial_amount_cents`. Call `refundClient.refundSettlement()`. Replace `dispute_reason` overload with proper `dispute_resolution_notes` field. Wire `disputeEmails.sendApproved*`. Same for reject → `sendRejected`. |
| `backend/src/controllers/payoutController.ts` | `openDispute`: accept optional `evidence_urls: string[]` array, persist. Wire `disputeEmails.sendOpened` (replace inline notification block). |
| `backend/src/routes/settlements.ts` | Add `POST /:id/dispute/evidence` (presigned S3 URL for upload) and `POST /:id/dispute/appeal` |
| `backend/src/lib/s3.ts` | Default region fix `us-east-1` → `us-east-2` (small-tech-debt item from TODO; lands free here) |
| `frontend/src/lib/api.ts` | Add `disputes.open`, `disputes.uploadEvidence`, `disputes.appeal` |
| `frontend/src/pages/SettlementPage.tsx` | Surface `DisputeSubmissionForm` for buyer when status === `ESCROW_HOLD` (currently just a placeholder button) |

### Out of scope (deferred to S25.5)

- Admin side-by-side review UI (`/admin/disputes` list + detail)
- Buyer dispute history page
- Buyer appeal UI form
- PaymentCloud / Signature / CCBill refund wiring (those processors are awaiting API keys per `MODULE_STATUS.md`; no point wiring stubs)

---

## Database migration (draft SQL)

All additive + optional — safe per `SCHEMA_LOCK.md` rules.

```sql
-- supabase/migrations/20260607000001_dispute_resolution_fields.sql

ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS evidence_urls               TEXT[]      DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS resolution_action           TEXT,        -- FULL_REFUND | PARTIAL_REFUND | REJECTED | APPEALED
  ADD COLUMN IF NOT EXISTS partial_refund_amount_cents BIGINT,
  ADD COLUMN IF NOT EXISTS dispute_resolution_notes    TEXT,
  ADD COLUMN IF NOT EXISTS processor_refund_id         TEXT,
  ADD COLUMN IF NOT EXISTS appeal_deadline             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS appeal_opened_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS appeal_reason               TEXT;

-- Optional enum-extension via CHECK constraint (avoids enum-in-same-txn lesson)
ALTER TABLE settlements
  ADD CONSTRAINT settlements_resolution_action_valid
  CHECK (
    resolution_action IS NULL
    OR resolution_action IN ('FULL_REFUND', 'PARTIAL_REFUND', 'REJECTED', 'APPEALED')
  );

-- Index for the admin queue (DISPUTED settlements sorted by oldest)
CREATE INDEX IF NOT EXISTS settlements_dispute_queue_idx
  ON settlements (dispute_opened_at)
  WHERE status = 'DISPUTED';

COMMENT ON COLUMN settlements.evidence_urls IS 'Array of S3 URLs for buyer-submitted dispute evidence (images/videos/docs)';
COMMENT ON COLUMN settlements.resolution_action IS 'Admin resolution action; NULL until DISPUTED→resolved transition';
COMMENT ON COLUMN settlements.processor_refund_id IS 'Refund ID from payment processor (e.g., Stripe re_xxx) for reconciliation';
```

**No locked-schema files touched.** Functions-side `settlement.schema.ts` stays frozen; new fields surface only via `database.types.ts` regen.

---

## API endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/settlements/:id/dispute` | buyer | Open dispute. Body: `{ reason: string, evidence_urls?: string[] }`. **Existing endpoint, extended.** |
| `POST` | `/api/v1/settlements/:id/dispute/evidence` | buyer | Get S3 presigned PUT URL for evidence upload. Body: `{ filename, content_type, size_bytes }`. Returns `{ upload_url, public_url }`. |
| `POST` | `/api/v1/settlements/:id/dispute/appeal` | buyer | Opens an appeal during the 7-day window after rejection. Body: `{ reason: string }`. Transitions `REFUNDED|ESCROW_HOLD → APPEALED`. |
| `POST` | `/api/v1/admin/disputes/:settlementId/approve` | admin | **Extended.** Body: `{ action: "FULL_REFUND"\|"PARTIAL_REFUND", partial_amount_cents?: number, notes: string }`. Calls Stripe refund, transitions → `REFUNDED`. |
| `POST` | `/api/v1/admin/disputes/:settlementId/reject` | admin | **Existing, lightly modified** — writes to `dispute_resolution_notes` + sets `appeal_deadline = now + 7d`. |

### State machine

```
ESCROW_HOLD
   │
   │ buyer POST /dispute
   ▼
DISPUTED ────► (admin approve FULL_REFUND)  ────► REFUNDED  ────(7d)──► closed
   │      ────► (admin approve PARTIAL)     ────► REFUNDED  ────(7d)──► closed
   │      ────► (admin reject)              ────► ESCROW_HOLD ──(7d)──► PAYOUT_RELEASED
   │                                              │
   │                                              │ buyer POST /appeal (within 7d)
   ▼                                              ▼
                                              APPEALED ──► admin re-reviews ──► REFUNDED or PAYOUT_RELEASED
```

`APPEALED` is a new state; admin views it the same way they view `DISPUTED` (no separate workflow).

---

## Notification matrix (Postmark)

| Trigger | Buyer email | Seller email |
|---|---|---|
| Buyer opens dispute | "Your dispute has been received" | "A dispute has been opened on your sale" |
| Admin approves (full refund) | "Refund issued — $X" | "Dispute resolved against you — full refund" |
| Admin approves (partial refund) | "Partial refund issued — $X (of $Y)" | "Partial refund issued from your sale" |
| Admin rejects | "Dispute decision — payment will release to seller" *(includes 7-day appeal link)* | "Dispute decided in your favor" |
| Buyer files appeal | "Appeal received — under review" | "Buyer has appealed the rejection" |

Templates live in `backend/src/lib/notifications/disputeEmails.ts`. Plain-HTML strings (matching the S23 pattern in `emailSender.ts` — no Postmark template IDs since DKIM has been verified per S23 close-out).

Notification preferences honored: skip if user has `dispute_opened = false` in `notification_preferences` (column already exists per migration `20260303000001_notifications.sql`).

---

## Refund wiring

The `StripeProcessor.refund()` lives in `supabase/functions/_shared/payment/processors/StripeProcessor.ts` (Deno). Two options for invoking it from the Express backend:

| Option | Approach | Tradeoff |
|---|---|---|
| **A** (proposed) | Direct `stripe` npm SDK call in `backend/src/lib/refundClient.ts` | Simplest. `stripe@^17` already in backend `package.json` per S21. No edge-function deploy needed. |
| **B** | New `process-refund` Supabase Edge Function mirroring `process-payment` | Keeps all processor logic in Edge Functions. Heavier; needs deploy + shared-secret auth. |

**Going with Option A** unless Boss flags otherwise. Code:

```ts
// backend/src/lib/refundClient.ts
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function refundStripePayment(
  paymentIntentId: string,
  amountCents?: number, // omit for full refund
): Promise<{ refundId: string; status: string }> {
  const refund = await stripe.refunds.create({
    payment_intent: paymentIntentId,
    amount: amountCents,
    reason: 'requested_by_customer',
  });
  return { refundId: refund.id, status: refund.status ?? 'unknown' };
}
```

Looking up the `payment_intent` from a settlement: `settlement.transaction_id → transactions.processor_transaction_id` (already populated by `process-payment` → Stripe webhook).

PaymentCloud / Signature / CCBill refunds: scoped out (no live API keys yet per `MODULE_STATUS.md`).

---

## Frontend changes (minimal in this session)

| Component | Route | Purpose |
|---|---|---|
| `DisputeSubmissionForm` | mounted on `/settlements/:id` | Reason picker (DELIVERY, ITEM_NOT_AS_DESCRIBED, COUNTERFEIT, OTHER) + multi-file dropzone using existing S3 upload hook + character-count textarea |

Everything else (admin review page, appeal UI, history page) → S25.5.

---

## Test plan

vitest specs (mocking Supabase client + Stripe SDK):

**`disputeController.spec.ts`**
- ✅ opens dispute on `ESCROW_HOLD` settlement
- ✅ rejects open when settlement not `ESCROW_HOLD`
- ✅ rejects open when caller is not the buyer
- ✅ rejects open when reason < 20 chars
- ✅ persists `evidence_urls` array
- ✅ appeal endpoint accepts during 7d window, rejects after

**`adminDisputes.spec.ts`**
- ✅ approve `FULL_REFUND` → calls Stripe refund with no amount → status `REFUNDED`
- ✅ approve `PARTIAL_REFUND` → calls Stripe refund with `partial_amount_cents`
- ✅ approve with `partial_amount_cents > gross_amount_cents` → 400
- ✅ approve with Stripe refund failure → 502 + no state change
- ✅ reject → status `ESCROW_HOLD` + `appeal_deadline` set 7d out
- ✅ reject sends rejection email with appeal-link
- ✅ approve sends both buyer + seller emails

**Out of scope:** Playwright E2E (deferred to S25.5 when UIs land).

---

## Dependencies & gates

- **None blocking.** No vendor gate (S25 is the parallel-to-S24 dispute path per TODO.md).
- Postmark already verified for staging (S23 close-out).
- Stripe staging keys already on App Runner (S21).
- The Boss-action Stripe webhook registration is **independent** of disputes — disputes invoke `stripe.refunds.create()` synchronously, not via webhook.

## Lessons honored this session

- **Edge Function env rotation needs re-deploy** — N/A this session (Option A keeps refund in Express).
- **Stripe pk/sk account mismatch** — backend uses the same `STRIPE_SECRET_KEY` already wired in S21; same account.
- **Settlements FK** — already fixed in `20260530000001`, but we'll grep to confirm no embed-join regressions.
- **Check existing routes before new components** — done; reusing `useS3Upload` hook from listings.
- **Don't add enum value + reference in same migration** — using CHECK constraint instead of pg enum.

## Estimated effort

| Block | Approx. lines | Notes |
|---|---|---|
| Migration | ~35 | additive only |
| `disputeEmails.ts` + 5 templates | ~250 | plain HTML strings, S23 pattern |
| `refundClient.ts` | ~40 | thin Stripe wrapper |
| Admin disputes route rewrite | ~120 | extends existing 148 lines |
| `payoutController.openDispute` extension | ~30 | adds evidence array |
| Buyer evidence + appeal endpoints | ~80 | new code in settlements router |
| `DisputeSubmissionForm` component | ~180 | form + dropzone |
| vitest specs | ~350 | two files |
| Total | **~1100 lines** | fits in one session; cushion for iteration |

**Verdict:** fits in one session if scoped to backend + minimal buyer form. Frontend admin UI lifts the line count by ~700+ and should be S25.5.

---

## Acceptance criteria (DoD)

- [ ] Migration applied to staging Supabase; `supabase gen types` updated
- [ ] `backend/` + `frontend/` both pass `npx tsc --noEmit`
- [ ] vitest specs green (`npm test -- disputes`)
- [ ] Manual curl smoke: open dispute → admin approve (partial) → see Stripe test-mode refund in dashboard
- [ ] Both parties receive Postmark emails (visible in Postmark activity log)
- [ ] `docs/SESSION_25_VERIFICATION.md` created
- [ ] TODO.md updated (drop completed S25 bullet; add S25.5 frontend bullet)
- [ ] Lesson + Decision entries pushed to Notion if anything non-obvious surfaces
- [ ] Branch `feature/session-25-disputes` merged to `dev`

---

## Open questions for Boss

1. **Option A vs B for refund wiring?** I propose A (direct Stripe SDK in backend) since the other processors are awaiting API keys and Option A is materially simpler. Want me to do B instead?
2. **Scope cut OK?** Splitting into S25 (backend) + S25.5 (admin UI + appeal UI). Or do you want one mega-session?
3. **Appeal window length** — Notion brief says "Optional 7-day appeal window". Confirm 7 days, or change?
4. **Refund reason mapping** — Stripe's enum is `duplicate | fraudulent | requested_by_customer`. I'll default everything to `requested_by_customer`; let me know if you want fraud-flagged disputes to use `fraudulent` (could affect chargeback metrics).
