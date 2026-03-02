/**
 * @module Module 02 Port — Auction Mechanics
 * Pure, deterministic auction state-machine functions.
 * Ported from functions/src/v1/services/auctions/auction.mechanics.ts
 *
 * All functions:
 * - Accept explicit nowMs (no Date.now() internally)
 * - Return Result<MechanicsOutput> — never throw to callers
 * - Are safe to call from any Express route handler or Edge Function
 */

import { z } from "zod";
import { AuctionMechanicsError, err, ok, Result } from "./errors";
import {
  AuctionCore,
  AuctionCoreSchema,
  MechanicsOutput,
  MechanicsOutputSchema,
  PlaceBidInput,
  PlaceBidInputSchema,
} from "./types";
import {
  assertMonotonicNonDecreasing,
  assertNotTerminal,
  assertRunningAndWithinWindow,
  assertTimeWindow,
} from "./invariants";
import { minIncrementCents, repriceProxyState } from "./proxy";

const NowMsSchema = z.number().int().nonnegative();

/**
 * Compute the patch required to transition a SCHEDULED auction to RUNNING.
 * Validates time window and status preconditions before producing the patch.
 */
export function computeStartAuction(args: { auction: AuctionCore; nowMs: number }): Result<MechanicsOutput> {
  try {
    const auction = AuctionCoreSchema.parse(args.auction);
    const nowMs = NowMsSchema.parse(args.nowMs);

    assertTimeWindow(auction, nowMs);
    assertNotTerminal(auction);

    const { startAtMs, endAtMs } = auction.schedule;

    if (auction.status !== "SCHEDULED") {
      throw new AuctionMechanicsError("AUCTION_NOT_SCHEDULED", "Auction must be SCHEDULED to start", {
        status: auction.status,
      });
    }
    if (nowMs < startAtMs) {
      throw new AuctionMechanicsError("AUCTION_NOT_STARTED_YET", "Too early to start auction", { nowMs, startAtMs });
    }
    if (nowMs >= endAtMs) {
      throw new AuctionMechanicsError("AUCTION_ALREADY_ENDED", "Auction window already ended; close instead", {
        nowMs,
        endAtMs,
      });
    }

    const out: MechanicsOutput = {
      preconditions: { auctionId: auction.id, expectedVersion: auction.version },
      patch: { status: "RUNNING", versionBump: 1 },
    };

    return ok(MechanicsOutputSchema.parse(out));
  } catch (e) {
    const ae =
      e instanceof AuctionMechanicsError
        ? e
        : new AuctionMechanicsError("INVARIANT_VIOLATION", "Unexpected error in computeStartAuction", { cause: e });
    return err(ae);
  }
}

/**
 * Compute the proxy-bid patch for a new bid.
 * Handles: first bid, high-bidder increasing max, and challenger scenarios.
 * Tie-break rule: incumbent wins on equal max.
 */
export function computePlaceBid(args: {
  auction: AuctionCore;
  input: PlaceBidInput;
  nowMs: number;
}): Result<MechanicsOutput> {
  try {
    const auction = AuctionCoreSchema.parse(args.auction);
    const input = PlaceBidInputSchema.parse(args.input);
    const nowMs = NowMsSchema.parse(args.nowMs);

    assertRunningAndWithinWindow(auction, nowMs);

    const { startPriceCents, currentPriceCents } = auction.pricing;

    if (input.maxCents < startPriceCents) {
      throw new AuctionMechanicsError("BID_BELOW_START_PRICE", "Bid max must be >= start price", {
        maxCents: input.maxCents,
        startPriceCents,
      });
    }

    const isHighBidder = auction.proxy.highBidderUid === input.bidderUid;
    const highUid = auction.proxy.highBidderUid;
    const highMax = auction.proxy.highBidderMaxCents;
    const secondMax = auction.proxy.secondHighestMaxCents;

    // Enforce "next increment" for non-leading bidders if auction already has a high bidder.
    if (!isHighBidder && highUid != null && highMax != null) {
      const minNext = currentPriceCents + minIncrementCents(currentPriceCents);
      if (input.maxCents < minNext) {
        throw new AuctionMechanicsError(
          "BID_MUST_BE_AT_LEAST_NEXT_INCREMENT",
          "Bid must be at least the next valid increment",
          { maxCents: input.maxCents, minNextCents: minNext, currentPriceCents }
        );
      }
    }

    // First bid
    if (highUid == null || highMax == null) {
      const repriced = repriceProxyState({
        startPriceCents,
        highBidderUid: input.bidderUid,
        highBidderMaxCents: input.maxCents,
        secondHighestMaxCents: null,
      });

      assertMonotonicNonDecreasing(repriced.currentPriceCents, currentPriceCents, "currentPriceCents");

      const out: MechanicsOutput = {
        preconditions: { auctionId: auction.id, expectedVersion: auction.version },
        patch: {
          proxy: {
            highBidderUid: repriced.proxy.highBidderUid,
            highBidderMaxCents: repriced.proxy.highBidderMaxCents,
            secondHighestMaxCents: repriced.proxy.secondHighestMaxCents,
          },
          pricing: { currentPriceCents: repriced.currentPriceCents },
          versionBump: 1,
        },
      };
      return ok(MechanicsOutputSchema.parse(out));
    }

    // High bidder increasing max (or keeping same)
    if (isHighBidder) {
      if (input.maxCents < highMax) {
        throw new AuctionMechanicsError("BIDDER_MAX_DECREASE", "High bidder cannot decrease their max", {
          bidderUid: input.bidderUid,
          prevMaxCents: highMax,
          nextMaxCents: input.maxCents,
        });
      }

      const repriced = repriceProxyState({
        startPriceCents,
        highBidderUid: highUid,
        highBidderMaxCents: input.maxCents,
        secondHighestMaxCents: secondMax,
      });

      assertMonotonicNonDecreasing(repriced.currentPriceCents, currentPriceCents, "currentPriceCents");

      const out: MechanicsOutput = {
        preconditions: { auctionId: auction.id, expectedVersion: auction.version },
        patch: {
          proxy: {
            highBidderUid: repriced.proxy.highBidderUid,
            highBidderMaxCents: repriced.proxy.highBidderMaxCents,
            secondHighestMaxCents: repriced.proxy.secondHighestMaxCents,
          },
          pricing: { currentPriceCents: repriced.currentPriceCents },
          versionBump: 1,
        },
      };
      return ok(MechanicsOutputSchema.parse(out));
    }

    // Challenger: deterministic tie-break — incumbent stays high on equal max.
    let nextHighUid = highUid;
    let nextHighMax = highMax;
    let nextSecondMax: number | null = secondMax;

    if (input.maxCents > highMax) {
      nextHighUid = input.bidderUid;
      nextHighMax = input.maxCents;
      nextSecondMax = highMax;
    } else if (input.maxCents === highMax) {
      nextHighUid = highUid;
      nextHighMax = highMax;
      nextSecondMax = highMax;
    } else {
      nextHighUid = highUid;
      nextHighMax = highMax;
      nextSecondMax = nextSecondMax == null ? input.maxCents : Math.max(nextSecondMax, input.maxCents);
    }

    const repriced = repriceProxyState({
      startPriceCents,
      highBidderUid: nextHighUid,
      highBidderMaxCents: nextHighMax,
      secondHighestMaxCents: nextSecondMax,
    });

    assertMonotonicNonDecreasing(repriced.currentPriceCents, currentPriceCents, "currentPriceCents");

    const out: MechanicsOutput = {
      preconditions: { auctionId: auction.id, expectedVersion: auction.version },
      patch: {
        proxy: {
          highBidderUid: repriced.proxy.highBidderUid,
          highBidderMaxCents: repriced.proxy.highBidderMaxCents,
          secondHighestMaxCents: repriced.proxy.secondHighestMaxCents,
        },
        pricing: { currentPriceCents: repriced.currentPriceCents },
        versionBump: 1,
      },
    };

    return ok(MechanicsOutputSchema.parse(out));
  } catch (e) {
    const ae =
      e instanceof AuctionMechanicsError
        ? e
        : new AuctionMechanicsError("INVARIANT_VIOLATION", "Unexpected error in computePlaceBid", { cause: e });
    return err(ae);
  }
}

/**
 * Compute the patch required to close an auction after its end time.
 * Produces NO_BIDS or TIME_ELAPSED close reason based on proxy state.
 */
export function computeCloseAuction(args: { auction: AuctionCore; nowMs: number }): Result<MechanicsOutput> {
  try {
    const auction = AuctionCoreSchema.parse(args.auction);
    const nowMs = NowMsSchema.parse(args.nowMs);

    assertTimeWindow(auction, nowMs);

    if (auction.status === "CLOSED" || auction.status === "VOIDED") {
      throw new AuctionMechanicsError("AUCTION_ALREADY_TERMINAL", "Auction is terminal", { status: auction.status });
    }

    const { endAtMs } = auction.schedule;

    if (nowMs < endAtMs) {
      throw new AuctionMechanicsError("INVARIANT_VIOLATION", "Too early to close auction by time", { nowMs, endAtMs });
    }

    const hasBids = auction.proxy.highBidderUid != null && auction.proxy.highBidderMaxCents != null;

    const winnerUid = hasBids ? auction.proxy.highBidderUid : null;
    const winningPriceCents = hasBids ? auction.pricing.currentPriceCents : auction.pricing.startPriceCents;

    const out: MechanicsOutput = {
      preconditions: { auctionId: auction.id, expectedVersion: auction.version },
      patch: {
        status: "CLOSED",
        close: {
          closedAtMs: nowMs,
          winnerUid,
          winningPriceCents,
          reason: hasBids ? "TIME_ELAPSED" : "NO_BIDS",
        },
        versionBump: 1,
      },
    };

    return ok(MechanicsOutputSchema.parse(out));
  } catch (e) {
    const ae =
      e instanceof AuctionMechanicsError
        ? e
        : new AuctionMechanicsError("INVARIANT_VIOLATION", "Unexpected error in computeCloseAuction", { cause: e });
    return err(ae);
  }
}
