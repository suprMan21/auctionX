import { orchEvent, type OrchestrationLogger } from "./orchestration.logging";
import { orchErr, type OrchestrationError } from "./orchestration.errors";

import { OfferCascadeCommandSchema, OfferCascadeResultOutSchema, type OfferCascadeResultOut } from "./auction.close.schemas";
import { OfferCascadeOutcomeSchema } from "./auction.close.types";

import { ListingsRepo } from "../../repos/listings.repo";
import { AuctionsRepo } from "../../repos/auctions.repo";
import { AuctionStateRepo } from "../../repos/auctionState.repo";
import { BidsRepo } from "../../repos/bids.repo";

import { repriceProxyState } from "../auctions/auction.proxy";

type OrchLogger = OrchestrationLogger;

const durationMs = () => 0;

type BidderMax = {
  bidderUid: string;
  maxCents: number;
  earliestPlacedAtMs: number;
};

function computeBidderMaxima(args: { bids: Array<{ bidderUid: string; amountCents: number; placedAtMs: number }> }): BidderMax[] {
  const byBidder = new Map<string, { maxCents: number; earliestAtForMax: number }>();

  for (const b of args.bids) {
    const cur = byBidder.get(b.bidderUid);
    if (!cur) {
      byBidder.set(b.bidderUid, { maxCents: b.amountCents, earliestAtForMax: b.placedAtMs });
      continue;
    }

    if (b.amountCents > cur.maxCents) {
      byBidder.set(b.bidderUid, { maxCents: b.amountCents, earliestAtForMax: b.placedAtMs });
      continue;
    }

    if (b.amountCents === cur.maxCents && b.placedAtMs < cur.earliestAtForMax) {
      byBidder.set(b.bidderUid, { maxCents: b.amountCents, earliestAtForMax: b.placedAtMs });
    }
  }

  const out: BidderMax[] = [];
  for (const [bidderUid, v] of byBidder.entries()) {
    out.push({ bidderUid, maxCents: v.maxCents, earliestPlacedAtMs: v.earliestAtForMax });
  }
  return out;
}

function rankBidderMaxima(maxima: BidderMax[]): BidderMax[] {
  return [...maxima].sort((a, b) => {
    if (b.maxCents !== a.maxCents) return b.maxCents - a.maxCents;
    return a.earliestPlacedAtMs - b.earliestPlacedAtMs;
  });
}

export type OfferCascadeDeps = {
  listingsRepo: ListingsRepo;
  auctionsMetaRepo: AuctionsRepo;
  auctionStateRepo: AuctionStateRepo;
  bidsRepo: BidsRepo;
  logger: OrchLogger;
  requestId: string;
};

export async function advanceOfferCascade(
  deps: OfferCascadeDeps,
  input: unknown
): Promise<{ ok: true; value: OfferCascadeResultOut } | { ok: false; error: OrchestrationError }> {
  const op = "advanceOfferCascade";

  const basePayload = (outcome: any) => ({
    requestId: deps.requestId,
    op,
    aggregate: "auction",
    outcome,
    durationMs: durationMs(),
  });

  try {
    deps.logger.info(orchEvent(op, "attempt"), basePayload("attempt"));
  } catch {}

  let cmd: { listingId: string; auctionId: string; nowMs: number; excludeBidderUids: string[] };

  try {
    cmd = OfferCascadeCommandSchema.parse(input);
  } catch (e) {
    const error = orchErr("VALIDATION_FAILED", "Invalid advanceOfferCascade command input", { zodError: e });
    try {
      deps.logger.warn(orchEvent(op, "validation_failed"), {
        ...basePayload("validation_failed"),
        auctionId: (input as any)?.auctionId,
        listingId: (input as any)?.listingId,
        error: { code: error.code, message: error.message },
      } as any);
    } catch {}
    return { ok: false, error };
  }

  const listing = await deps.listingsRepo.get(cmd.listingId);
  if (!listing) {
    const error = orchErr("NOT_FOUND", `Listing not found: ${cmd.listingId}`);
    try {
      deps.logger.warn(orchEvent(op, "not_found"), {
        ...basePayload("not_found"),
        listingId: cmd.listingId,
        auctionId: cmd.auctionId,
        error: { code: error.code, message: error.message },
      } as any);
    } catch {}
    return { ok: false, error };
  }

  const auctionMeta = await deps.auctionsMetaRepo.get(cmd.listingId, cmd.auctionId);
  if (!auctionMeta) {
    const error = orchErr("NOT_FOUND", `Auction not found: ${cmd.listingId}/${cmd.auctionId}`);
    try {
      deps.logger.warn(orchEvent(op, "not_found"), {
        ...basePayload("not_found"),
        listingId: cmd.listingId,
        auctionId: cmd.auctionId,
        error: { code: error.code, message: error.message },
      } as any);
    } catch {}
    return { ok: false, error };
  }

  const state = await deps.auctionStateRepo.getState(cmd.listingId, cmd.auctionId);
  if (!state) {
    const error = orchErr("NOT_FOUND", `AuctionState not found: ${cmd.listingId}/${cmd.auctionId}`);
    try {
      deps.logger.warn(orchEvent(op, "not_found"), {
        ...basePayload("not_found"),
        listingId: cmd.listingId,
        auctionId: cmd.auctionId,
        error: { code: error.code, message: error.message },
      } as any);
    } catch {}
    return { ok: false, error };
  }

  const close = state.close;
  if (!close || !close.closedAtMs) {
    const error = orchErr("PRECONDITION_FAILED", "Cannot cascade offers: auction is not closed", {
      listingId: cmd.listingId,
      auctionId: cmd.auctionId,
    });
    try {
      deps.logger.warn(orchEvent(op, "precondition_failed"), {
        ...basePayload("precondition_failed"),
        listingId: cmd.listingId,
        auctionId: cmd.auctionId,
        error: { code: error.code, message: error.message },
      } as any);
    } catch {}
    return { ok: false, error };
  }

  const bids = await deps.bidsRepo.listByAuction(cmd.listingId, cmd.auctionId, 500);
  const normalized = bids.map((b) => ({
    bidderUid: b.bidderUid,
    amountCents: b.amountCents,
    placedAtMs: b.placedAt.toMillis(),
  }));

  const excluded = new Set<string>(cmd.excludeBidderUids ?? []);
  if (close.winnerUid) excluded.add(close.winnerUid);

  const maxima = computeBidderMaxima({ bids: normalized }).filter((m) => !excluded.has(m.bidderUid));
  const ranked = rankBidderMaxima(maxima);

  if (ranked.length === 0) {
    const outcome = OfferCascadeOutcomeSchema.parse({
      kind: "NO_ELIGIBLE_BIDDERS",
      listingId: cmd.listingId,
      auctionId: cmd.auctionId,
      closedAtMs: close.closedAtMs,
    });

    const value = OfferCascadeResultOutSchema.parse({
      listingId: cmd.listingId,
      auctionId: cmd.auctionId,
      outcome,
      computed: { nextWinnerUid: null, excludedUids: Array.from(excluded) },
    });

    try {
      deps.logger.info(orchEvent(op, "success"), {
        ...basePayload("success"),
        listingId: cmd.listingId,
        auctionId: cmd.auctionId,
      } as any);
    } catch {}

    return { ok: true, value };
  }

  const startPriceCents = state.pricing.startPriceCents;

  const high = ranked[0];
  const second = ranked[1];

  const repriced = repriceProxyState({
    startPriceCents,
    highBidderUid: high.bidderUid,
    highBidderMaxCents: high.maxCents,
    secondHighestMaxCents: second ? second.maxCents : null,
  });

  const reserve = listing.pricing?.reservePriceCents ?? null;
  const sellerUid = auctionMeta.snapshot?.sellerUid;

  const outcome = OfferCascadeOutcomeSchema.parse({
    kind: "PAYMENT_REQUIRED",
    listingId: cmd.listingId,
    auctionId: cmd.auctionId,
    buyerUid: repriced.proxy.highBidderUid,
    sellerUid: sellerUid ?? "UNKNOWN_SELLER",
    amountCents: repriced.currentPriceCents,
    currency: "CAD",
    reservePriceCents: reserve,
    reason: "CASCADE_OFFER",
  });

  const value = OfferCascadeResultOutSchema.parse({
    listingId: cmd.listingId,
    auctionId: cmd.auctionId,
    outcome,
    computed: {
      nextWinnerUid: repriced.proxy.highBidderUid,
      offerPriceCents: repriced.currentPriceCents,
      excludedUids: Array.from(excluded),
    },
  });

  try {
    deps.logger.info(orchEvent(op, "success"), {
      ...basePayload("success"),
      listingId: cmd.listingId,
      auctionId: cmd.auctionId,
    } as any);
  } catch {}

  return { ok: true, value };
}
