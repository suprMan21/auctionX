/**
 * @module Module 02 Port — Auction Mechanics
 * Smoke tests for the ported auction mechanics functions.
 * Run: npx vitest run src/lib/auction/__tests__/mechanics.test.ts
 */

import { describe, it, expect } from "vitest";
import { computePlaceBid, computeCloseAuction } from "../mechanics";
import type { AuctionCore } from "../types";

/** Minimal RUNNING auction fixture. */
const baseAuction: AuctionCore = {
  id: "auction-1",
  listingId: "listing-1",
  status: "RUNNING",
  schedule: {
    startAtMs: 1000,
    endAtMs: 9000,
  },
  pricing: {
    startPriceCents: 500,
    currentPriceCents: 500,
  },
  version: 0,
  updatedAtMs: 1000,
  proxy: {
    highBidderUid: null,
    highBidderMaxCents: null,
    secondHighestMaxCents: null,
  },
};

const NOW_MS = 5000; // within the [1000, 9000) window

describe("computePlaceBid", () => {
  it("accepts first bid and sets highBidder", () => {
    const result = computePlaceBid({
      auction: baseAuction,
      input: { bidderUid: "user-a", maxCents: 1000 },
      nowMs: NOW_MS,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { patch } = result.value;
    expect(patch.proxy?.highBidderUid).toBe("user-a");
    expect(patch.proxy?.highBidderMaxCents).toBe(1000);
    // First bid with no competition => price stays at startPrice
    expect(patch.pricing?.currentPriceCents).toBe(500);
    expect(patch.versionBump).toBe(1);
  });

  it("rejects a bid below the start price", () => {
    const result = computePlaceBid({
      auction: baseAuction,
      input: { bidderUid: "user-a", maxCents: 400 }, // below startPriceCents 500
      nowMs: NOW_MS,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BID_BELOW_START_PRICE");
  });
});

describe("computeCloseAuction", () => {
  it("closes with NO_BIDS when there is no high bidder", () => {
    const result = computeCloseAuction({
      auction: baseAuction,
      nowMs: 10000, // past endAtMs 9000
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { patch } = result.value;
    expect(patch.status).toBe("CLOSED");
    expect(patch.close?.reason).toBe("NO_BIDS");
    expect(patch.close?.winnerUid).toBeNull();
  });

  it("closes with TIME_ELAPSED and a winner when bids exist", () => {
    const auctionWithBid: AuctionCore = {
      ...baseAuction,
      pricing: { startPriceCents: 500, currentPriceCents: 750 },
      proxy: {
        highBidderUid: "user-a",
        highBidderMaxCents: 2000,
        secondHighestMaxCents: null,
      },
    };

    const result = computeCloseAuction({
      auction: auctionWithBid,
      nowMs: 10000, // past endAtMs 9000
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { patch } = result.value;
    expect(patch.status).toBe("CLOSED");
    expect(patch.close?.reason).toBe("TIME_ELAPSED");
    expect(patch.close?.winnerUid).toBe("user-a");
    expect(patch.close?.winningPriceCents).toBe(750); // currentPriceCents
  });
});
