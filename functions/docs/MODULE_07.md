# Module 08 — Payouts, Fees & Taxes — DRAFT (Unlocked Until Postflight PASS)

## Goals
Introduce a deterministic payout and fee model that:
- Releases funds to sellers after successful settlement
- Accounts for platform fees
- Supports tax withholding / tax-on-fee accounting (no remittance automation yet)
- Preserves ability to hold, reverse, or delay payouts for disputes (forward-compat)

## Non-negotiables (Respected)
- No changes to auction mechanics or AuctionState.close invariants
- No changes to settlement semantics or payment authorization behavior
- No Stripe concepts or identifiers in domain schemas
- Idempotency via requestId
- Optimistic concurrency via expectedVersion
- Orchestration owns logging; repos/mechanics are silent
- Emulator-first validation via payoutGate and postflight

## New Persistence Surface
### payouts (top-level collection)
- Collection: `payouts`
- Payout id: `payout.id === settlement.id` (1:1 mapping)
- Payout is created only after `Settlement.status === SETTLED`

Rationale:
- Mirrors `settlements` storage pattern
- Deterministic mapping avoids secondary indexes or guessed keys
- Supports future dispute/override modules by adding hold/reversal states without touching settlements

## Payout Lifecycle
Status:
- NOT_READY (reserved)
- READY (settlement settled + payable)
- ON_HOLD (explicit hold; blocks release)
- RELEASE_REQUESTED (reserved)
- RELEASED (released recorded as complete)
- FAILED_RETRYABLE (reserved)
- FAILED_TERMINAL (reserved)
- VOIDED (for non-payable settlements)

Forward-compat notes:
- Module 09 can introduce reversal states and partial reversals without changing the payout id scheme.
- Module 10 can introduce admin hold/release/cancel using existing hold fields.

## Fee Model (Deterministic)
Inputs:
- grossAmountCents (from Settlement.amountCents; settlement is derived from authoritative AuctionState.close)

Computation:
- platformFeeCents = round(gross * feeBps / 10000) + fixedCents

Config (env):
- PAYOUT_PLATFORM_FEE_BPS (default 0)
- PAYOUT_PLATFORM_FEE_FIXED_CENTS (default 0)
- PAYOUT_FEE_RULESET_VERSION (default FEE_V1)

Outputs:
- FeeQuote snapshot persisted on payout for auditability

## Tax Handling Model (Withholding Only)
Two concepts:
1) Seller withholding (reduces seller net)
2) Platform fee tax (accounting-only; remittance deferred)

Config (env):
- PAYOUT_SELLER_WITHHOLDING_BPS (default 0)
- PAYOUT_PLATFORM_FEE_TAX_BPS (default 0)
- PAYOUT_TAX_JURISDICTION_CODE (default null)
- PAYOUT_TAX_RULESET_VERSION (default TAX_V1)

TODO (explicitly out of scope):
- Remittance automation
- Filing schedules
- Tax forms

## Orchestration Flows
- createPayoutFromSettlement
  - Preconditions: Settlement.status=SETTLED
  - If outcomeKind != PAYMENT_REQUIRED => payout VOIDED
  - Else => compute fee/tax/net and create payout READY
- holdPayout
  - Moves payout to ON_HOLD (no-op if RELEASED/VOIDED)
- releasePayoutHold
  - Moves payout ON_HOLD -> READY
- releasePayout
  - Moves READY/FAILED_RETRYABLE -> RELEASED
  - No provider integration at this layer

## Emulator-first Gates
### scripts/payoutGate.ts
- Finds latest SETTLED settlement (avoids guessing ids)
- Creates payout from settlement
- Releases payout
- Re-runs create for idempotency

### scripts/postflightGate.ts
Now includes `payoutGate.ts` step and requires marker:
- `PAYOUT GATE: PASS`

## Lessons Learned (Module 08)
- Avoid touching existing domain indexes/exports when modules are immutable; import new schema directly where used.
- Avoid guessing identifiers in gates; query for authoritative docs (latest SETTLED settlement) to keep gates resilient.
- Persist fee/tax snapshots on payout to support future disputes/reversals without recalculating under new rulesets.
