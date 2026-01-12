# MODULE 05 — Auction Close & Offer Cascade

## Scope (Locked)
IN:
- Auction close orchestration (deterministic)
- Offer cascade orchestration (2nd/3rd bidder offers)
- Reserve-not-met outcome emission (payment-ready, not persisted)
- Relist eligibility enforcement (read-only; enforcement result emitted)
- AuctionState updates via existing optimistic concurrency path (`applyMechanicsPatch`)
- Structured orchestration logging (attempt/success/rejection)
- Emulator-first deterministic debug flows via scripts

OUT:
- Stripe/payments capture, authorization updates, refunds, payouts
- Background schedulers, cron, triggers
- UI changes
- Trust scoring
- Schema refactors

## Determinism & Layering
All state changes follow:
mechanics → orchestration → repository

- Mechanics remains pure (no clock access; `nowMs` is an input).
- Orchestration coordinates reads/writes and emits outcomes.
- Repositories perform IO + persistence validation only.
- No logging in mechanics or repos.

## Persistence Inputs (Authoritative)
- Listing reserve price:
  - `Listing.pricing.reservePriceCents` (optional)
- Auction relist iteration:
  - `Auction.iteration` (0..2)
- Close winner + winning price are persisted to AuctionState close:
  - `AuctionState.close.{winnerUid, winningPriceCents, closedAtMs, reason}`

## Close Auction (Orchestration)
File:
- `functions/src/v1/services/orchestration/auction.close.orchestrator.ts`

Flow:
1) Validate command `{ listingId, auctionId, nowMs }`
2) Load AuctionCore via aggregate adapter (Auction + AuctionState)
3) Load Listing for reserve price (read-only)
4) Load Auction meta for sellerUid + iteration (read-only)
5) Run mechanics `computeCloseAuction({ auction, nowMs })`
6) Apply patch via `applyMechanicsPatch` (optimistic concurrency)
7) Emit a payment-ready outcome object (not persisted)

Outcomes:
- `NO_BIDS`
- `RESERVE_NOT_MET`
- `PAYMENT_REQUIRED` (winner-at-close)

Important:
- Reserve-not-met does not modify persistence in this module.
- Payment state is not persisted.

## Offer Cascade (Non-payment)
File:
- `functions/src/v1/services/orchestration/auction.offerCascade.orchestrator.ts`

Purpose:
Given a closed auction and a set of excluded bidder UIDs (including the failed winner), determine the next candidate and the price to offer.

Deterministic bidder ranking:
- For each bidder: compute max `amountCents` across their bids
- Tie-break: earliest `placedAt` timestamp at that max
- Sort by:
  1) maxCents desc
  2) earliestPlacedAtMs asc

Price computation:
- Reuse proxy repricing helper:
  - `repriceProxyState({ startPriceCents, highBidderUid, highBidderMaxCents, secondHighestMaxCents })`
- Offer price is `repriced.currentPriceCents`

Outcomes:
- `PAYMENT_REQUIRED` (reason: `CASCADE_OFFER`)
- `NO_ELIGIBLE_BIDDERS`

Persistence:
- No persistence writes in cascade (no payment state fields exist; no schema changes allowed).

## Emulator-first Debug Flows
Scripts:
- `functions/scripts/debugCloseAuction.ts`
- `functions/scripts/debugOfferCascade.ts`

Typical flow:
1) Seed auction/state (existing `seedAuction.ts`)
2) Place bids (existing `debugPlaceBid.ts`)
3) Close auction (`debugCloseAuction.ts`)
4) Cascade offer (`debugOfferCascade.ts`) excluding failed winner

## Notes for Module 06+
This module emits payment-ready intent objects but does not persist payment state.
Module 06 should consume:
- `PaymentReadyIntent` payloads for authorization/capture orchestration
- Cascade offer payloads for second-chance payment attempts

