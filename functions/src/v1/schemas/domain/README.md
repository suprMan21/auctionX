# Legacy Domain Schemas — REFERENCE ONLY

These Zod schemas were written for the Firebase/Firestore architecture (Modules 01-02).
They import `firebase-admin/firestore` and CANNOT validate at runtime in the current
Supabase architecture.

## What's here

- `common.schema.ts` — Base types (FirestoreTimestamp, currency, etc.)
- `auction.schema.ts` — Auction domain model
- `auctionState.schema.ts` — Auction state machine
- `bid.schema.ts` — Bid domain model
- `listing.schema.ts` — Listing domain model
- `user.schema.ts` — User domain model
- `settlement.schema.ts` — Settlement domain model
- `payout.schema.ts` — Payout domain model
- `category.schema.ts` — Category domain model
- `dispute.schema.ts` — Dispute domain model
- `enums.schema.ts` — Shared enums
- `index.ts` — Re-exports

## Status

- **LOCKED** — do not modify (see `docs/SCHEMA_LOCK.md`)
- Enum values have **DIVERGED** from production SQL — see `docs/AUDIT_REPORT.md` Section 4
  - `ListingStatus`: schema has `SUSPENDED/ARCHIVED`, SQL has `PENDING_REVIEW/SOLD/CANCELLED/REMOVED`
  - `AuctionStatus`: schema has `RUNNING/CLOSED/VOIDED`, SQL has `ACTIVE/ENDED/CANCELLED/SETTLED`
  - `PaymentProcessor`: schema has `SEGPAY` only, SQL has 5-processor cascade
- Use `frontend/src/types/database.types.ts` (generated from Supabase) as the source of truth for runtime types

## Valuable Code to Port (when Module 11 begins)

The auction mechanics in `../services/auctions/` are **pure TypeScript functions with
no Firebase dependency** (verified: zero firebase imports). These should be ported to
`backend/src/lib/auction/` when Module 11 (Settlement) begins:

- `auction.mechanics.ts` — Core bid/auction state transitions
- `auction.proxy.ts` — eBay-style proxy bidding logic
- `auction.invariants.ts` — Business rule validators
- `auction.types.ts` — Shared types for the above
- `auction.errors.ts` — Typed error classes
