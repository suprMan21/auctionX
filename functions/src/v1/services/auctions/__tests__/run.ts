import assert from "node:assert/strict";
import { computeCloseAuction, computePlaceBid, computeStartAuction } from "../auction.mechanics";
import type { AuctionCore } from "../auction.types";

function baseAuction(overrides?: Partial<AuctionCore>): AuctionCore {
  const baseNow = 1_000_000;
  return {
    id: "a1",
    listingId: "l1",
    status: "SCHEDULED",
    schedule: { startAtMs: baseNow + 1000, endAtMs: baseNow + 10_000 },
    pricing: { startPriceCents: 10_00, currentPriceCents: 10_00 },
    version: 0,
    updatedAtMs: baseNow,
    proxy: { highBidderUid: null, highBidderMaxCents: null, secondHighestMaxCents: null },
    ...(overrides ?? {}),
  };
}

function mustOk<T>(r: any): T {
  assert.equal(r.ok, true, r.ok ? "expected ok" : r.error?.message);
  return r.value as T;
}

function mustErr(r: any, code: string) {
  assert.equal(r.ok, false, "expected err");
  assert.equal(r.error.code, code);
}

(function run() {
  // START: too early
  {
    const a = baseAuction({ status: "SCHEDULED" });
    const r = computeStartAuction({ auction: a, nowMs: a.schedule.startAtMs - 1 });
    mustErr(r, "AUCTION_NOT_STARTED_YET");
  }

  // START: ok
  {
    const a = baseAuction({ status: "SCHEDULED" });
    const r = computeStartAuction({ auction: a, nowMs: a.schedule.startAtMs });
    const out = mustOk<any>(r);
    assert.equal(out.patch.status, "RUNNING");
  }

  // BID: first bid sets high bidder; price remains start price
  {
    const now = 2_000_000;
    const a = baseAuction({
      status: "RUNNING",
      schedule: { startAtMs: now - 1000, endAtMs: now + 10_000 },
      pricing: { startPriceCents: 10_00, currentPriceCents: 10_00 },
    });

    const r = computePlaceBid({ auction: a, input: { bidderUid: "u1", maxCents: 20_00 }, nowMs: now });
    const out = mustOk<any>(r);
    assert.equal(out.patch.proxy.highBidderUid, "u1");
    assert.equal(out.patch.pricing.currentPriceCents, 10_00);
  }

  // BID: challenger below next increment fails
  {
    const now = 3_000_000;
    const a = baseAuction({
      status: "RUNNING",
      schedule: { startAtMs: now - 1000, endAtMs: now + 10_000 },
      pricing: { startPriceCents: 10_00, currentPriceCents: 10_00 },
      proxy: { highBidderUid: "u1", highBidderMaxCents: 20_00, secondHighestMaxCents: null },
    });

    // currentPrice=10.00, inc=1.00 => min next = 11.00
    const r = computePlaceBid({ auction: a, input: { bidderUid: "u2", maxCents: 10_50 }, nowMs: now });
    mustErr(r, "BID_MUST_BE_AT_LEAST_NEXT_INCREMENT");
  }

  // BID: challenger sets second, price becomes second+inc (up to high max)
  {
    const now = 4_000_000;
    const a = baseAuction({
      status: "RUNNING",
      schedule: { startAtMs: now - 1000, endAtMs: now + 10_000 },
      pricing: { startPriceCents: 10_00, currentPriceCents: 10_00 },
      proxy: { highBidderUid: "u1", highBidderMaxCents: 50_00, secondHighestMaxCents: null },
    });

    const r = computePlaceBid({ auction: a, input: { bidderUid: "u2", maxCents: 20_00 }, nowMs: now });
    const out = mustOk<any>(r);

    // second=20, price=21 (20 + 1 increment)
    assert.equal(out.patch.proxy.highBidderUid, "u1");
    assert.equal(out.patch.proxy.secondHighestMaxCents, 20_00);
    assert.equal(out.patch.pricing.currentPriceCents, 21_00);
  }

  // CLOSE: too early fails
  {
    const now = 5_000_000;
    const a = baseAuction({
      status: "RUNNING",
      schedule: { startAtMs: now - 1000, endAtMs: now + 10_000 },
    });
    const r = computeCloseAuction({ auction: a, nowMs: now });
    mustErr(r, "INVARIANT_VIOLATION");
  }

  // CLOSE: no bids => winner null
  {
    const now = 6_000_000;
    const a = baseAuction({
      status: "SCHEDULED",
      schedule: { startAtMs: now - 20_000, endAtMs: now - 1 },
      pricing: { startPriceCents: 10_00, currentPriceCents: 10_00 },
      proxy: { highBidderUid: null, highBidderMaxCents: null, secondHighestMaxCents: null },
    });
    const r = computeCloseAuction({ auction: a, nowMs: now });
    const out = mustOk<any>(r);
    assert.equal(out.patch.status, "CLOSED");
    assert.equal(out.patch.close.winnerUid, null);
    assert.equal(out.patch.close.reason, "NO_BIDS");
  }

  console.log("✅ auction mechanics tests passed");
})();
