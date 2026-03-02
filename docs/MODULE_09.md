# Module 09 — Disputes, Refunds & Chargebacks (Provider-Agnostic Core)

## Goal
Introduce a provider-neutral Dispute lifecycle that can:
- Create and track disputes (item not received, not as described, unauthorized, other)
- Place holds to block payout release (MVP = wrapper enforcement)
- Record refund intent and outcomes (provider-neutral)
- Represent chargeback events (provider-neutral)
- Preserve auditability and idempotency

## What shipped
### Dispute aggregate (provider-neutral)
New collection:
- `disputes/{disputeId}`

Key fields:
- Links: `listingId`, `auctionId`, optional `settlementId`, optional `payoutId`
- Parties: `buyerUid`, `sellerUid`
- Classification: `reasonCode`, optional `reasonText`
- State: `status`, optional terminal `outcomeKind`
- Hold: `hold.status` (NONE | PLACED | RELEASED)
- Refund: `refund.status` + intent fields (provider-neutral)
- Chargeback: `chargeback.status` + optional generic `externalRef`
- Audit: `events[]`
- Idempotency: `idempotency[requestId] = { op, atMs }`
- Concurrency: `version` increments per mutation

### Orchestration (idempotent + versioned)
Entry points:
- createDispute
- placeHold / releaseHold
- recordRefundIntent / setRefundStatus
- reportChargeback / setChargebackStatus
- resolveDispute / cancelDispute

Rules:
- Create is idempotent by requestId + “createIfAbsent”
- All mutations require `requestId` and `expectedVersion`

### MVP payout hold integration (Option A)
Wrapper-only enforcement:
- `releasePayoutIfNoActiveDisputeHold({ payoutId, requestId, release })`

Behavior:
- If any dispute exists with `payoutId` and `hold.status=PLACED`, wrapper returns `{ blocked: true }` and does not call `release()`.
- Otherwise wrapper calls `release()`.

## Gates
Added:
- `scripts/disputeGate.ts`
Integrated into postflight and asserts:
- create dispute
- place hold blocks wrapper release
- release hold allows wrapper release

## Lessons learned
1) Wrapper enforcement is lowest-cascade MVP but requires caller discipline.
2) Provider neutrality is preserved by recording refund/chargeback as domain facts rather than provider objects.
3) In-doc idempotency maps are simple but need a future retention/bounding strategy.

## Forward-compat plan (Option B: true enforcement)
Objective:
- Make payout release dispute-safe by default by adding a pre-check inside payout release orchestration.

Constraints:
- No payout schema changes
- No importing dispute enums/types into payout logic
- Read-only dependency: a single boolean check

TODO-B1:
- Add eligibility check inside payout release orch:
  - if blocked -> deterministic error `PAYOUT_BLOCKED_BY_DISPUTE`

TODO-B2:
- Preserve idempotency semantics:
  - blocked should be stable and not treated as success

TODO-B3:
- Extend postflight with one additional scenario covering the real payout release path

TODO-B4:
- Treat as explicit lock-break with surgical diff and a dedicated commit
