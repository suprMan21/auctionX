import { AuctionCore, MoneyCents } from "./auction.types";
import { AuctionMechanicsError } from "./auction.errors";

export function assertTimeWindow(auction: AuctionCore, nowMs: number): void {
  const { startAtMs, endAtMs } = auction.schedule;
  if (endAtMs < startAtMs) {
    throw new AuctionMechanicsError("INVALID_TIME_WINDOW", "Auction endAt must be >= startAt", {
      startAtMs,
      endAtMs,
    });
  }
  if (nowMs < 0) {
    throw new AuctionMechanicsError("INVARIANT_VIOLATION", "nowMs must be >= 0", { nowMs });
  }
}

export function assertNotTerminal(auction: AuctionCore): void {
  if (auction.status === "CLOSED" || auction.status === "VOIDED") {
    throw new AuctionMechanicsError("AUCTION_ALREADY_TERMINAL", "Auction is terminal", {
      status: auction.status,
    });
  }
}

export function assertRunningAndWithinWindow(auction: AuctionCore, nowMs: number): void {
  assertTimeWindow(auction, nowMs);
  if (auction.status !== "RUNNING") {
    throw new AuctionMechanicsError("AUCTION_NOT_RUNNING", "Auction must be RUNNING to bid", {
      status: auction.status,
    });
  }
  const { startAtMs, endAtMs } = auction.schedule;
  if (nowMs < startAtMs) {
    throw new AuctionMechanicsError("AUCTION_NOT_STARTED_YET", "Auction has not started", {
      nowMs,
      startAtMs,
    });
  }
  if (nowMs >= endAtMs) {
    throw new AuctionMechanicsError("AUCTION_ALREADY_ENDED", "Auction has ended", {
      nowMs,
      endAtMs,
    });
  }
}

export function assertMonotonicNonDecreasing(next: MoneyCents, prev: MoneyCents, label: string): void {
  if (next < prev) {
    throw new AuctionMechanicsError("INVARIANT_VIOLATION", `${label} must not decrease`, { prev, next });
  }
}
