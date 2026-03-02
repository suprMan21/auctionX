import { orchEvent, type OrchestrationLogger } from "./orchestration.logging";
import { orchErr, type OrchestrationError } from "./orchestration.errors";
import { VersionTokenSchema } from "./orchestration.types";

import { CloseAuctionCommandSchema, CloseAuctionResultOutSchema, type CloseAuctionResultOut } from "./auction.close.schemas";
import { CloseAuctionOutcomeSchema } from "./auction.close.types";

import { AuctionCoreSchema, PreconditionsSchema, AuctionPatchSchema, type AuctionCore, type Preconditions, type AuctionPatch } from "../auctions/auction.types";
import { computeCloseAuction } from "../auctions/auction.mechanics";
import type { AuctionMechanicsError } from "../auctions/auction.errors";

import { ListingsRepo } from "../../repos/listings.repo";
import { AuctionsRepo } from "../../repos/auctions.repo";

export type AuctionsAggregateRepoPort = {
  getCore: (listingId: string, auctionId: string) => Promise<{ value: AuctionCore; version: string | number } | null>;
  applyMechanicsPatch: (args: {
    listingId: string;
    auctionId: string;
    expectedVersion: number;
    preconditions: Preconditions;
    patch: AuctionPatch;
    nowMs: number;
  }) => Promise<{ value: AuctionCore; version: string | number }>;
};

export type CloseAuctionDeps = {
  auctionsRepo: AuctionsAggregateRepoPort;
  listingsRepo: ListingsRepo;
  auctionsMetaRepo: AuctionsRepo;
  logger: OrchestrationLogger;
  requestId: string;
};

const durationMs = () => 0;

export async function closeAuction(
  deps: CloseAuctionDeps,
  input: unknown
): Promise<{ ok: true; value: CloseAuctionResultOut } | { ok: false; error: OrchestrationError }> {
  const op = "closeAuction";

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

  let cmd: { listingId: string; auctionId: string; nowMs: number };

  try {
    cmd = CloseAuctionCommandSchema.parse(input);
  } catch (e) {
    const error = orchErr("VALIDATION_FAILED", "Invalid closeAuction command input", { zodError: e });
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

  const found = await deps.auctionsRepo.getCore(cmd.listingId, cmd.auctionId);
  if (!found) {
    const error = orchErr("NOT_FOUND", `Auction not found: ${cmd.listingId}/${cmd.auctionId}`);
    try {
      deps.logger.warn(orchEvent(op, "not_found"), {
        ...basePayload("not_found"),
        auctionId: cmd.auctionId,
        listingId: cmd.listingId,
        error: { code: error.code, message: error.message },
      } as any);
    } catch {}
    return { ok: false, error };
  }

  const auction = AuctionCoreSchema.parse(found.value);
  const readVersion = VersionTokenSchema.parse(found.version);
  const expectedVersion = typeof readVersion === "number" ? readVersion : auction.version;

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
    const error = orchErr("NOT_FOUND", `Auction meta not found: ${cmd.listingId}/${cmd.auctionId}`);
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

  const mechanicsRes = computeCloseAuction({ auction, nowMs: cmd.nowMs });

  if (!mechanicsRes.ok) {
    const ae = mechanicsRes.error as AuctionMechanicsError;
    const error = orchErr(ae.code ?? "UNEXPECTED_ERROR", ae.message ?? "Mechanics rejected close", {
      details: (ae as any).details,
    });

    try {
      deps.logger.warn(orchEvent(op, "precondition_failed"), {
        ...basePayload("precondition_failed"),
        auctionId: cmd.auctionId,
        listingId: cmd.listingId,
        expectedVersion,
        error: { code: error.code, message: error.message },
      } as any);
    } catch {}

    return { ok: false, error };
  }

  const mechanicsOut = mechanicsRes.value;
  const patch = AuctionPatchSchema.parse(mechanicsOut.patch);
  const pre = PreconditionsSchema.parse(mechanicsOut.preconditions);

  try {
    const applied = await deps.auctionsRepo.applyMechanicsPatch({
      listingId: cmd.listingId,
      auctionId: cmd.auctionId,
      expectedVersion,
      preconditions: pre,
      patch,
      nowMs: cmd.nowMs,
    });

    const updatedAuction = AuctionCoreSchema.parse(applied.value);

    const close = patch.close!;
    const reserve = listing.pricing?.reservePriceCents;
    const sellerUid = auctionMeta.snapshot?.sellerUid;

    let outcome: any;

    if (!close.winnerUid) {
      outcome = {
        kind: "NO_BIDS",
        listingId: cmd.listingId,
        auctionId: cmd.auctionId,
        closedAtMs: close.closedAtMs,
      };
    } else if (reserve != null && close.winningPriceCents < reserve) {
      outcome = {
        kind: "RESERVE_NOT_MET",
        listingId: cmd.listingId,
        auctionId: cmd.auctionId,
        closedAtMs: close.closedAtMs,
        winnerUid: close.winnerUid,
        winningPriceCents: close.winningPriceCents,
        reservePriceCents: reserve,
      };
    } else {
      outcome = {
        kind: "PAYMENT_REQUIRED",
        listingId: cmd.listingId,
        auctionId: cmd.auctionId,
        buyerUid: close.winnerUid,
        sellerUid: sellerUid ?? "UNKNOWN_SELLER",
        amountCents: close.winningPriceCents,
        currency: "CAD",
        reservePriceCents: reserve ?? null,
        reason: "WINNER_AT_CLOSE",
      };
    }

    const parsedOutcome = CloseAuctionOutcomeSchema.parse(outcome);

    const value = CloseAuctionResultOutSchema.parse({
      auction: updatedAuction,
      close: {
        closedAtMs: close.closedAtMs,
        winnerUid: close.winnerUid,
        winningPriceCents: close.winningPriceCents,
        reason: close.reason ?? "TIME_ELAPSED",
      },
      outcome: parsedOutcome,
    });

    try {
      deps.logger.info(orchEvent(op, "success"), {
        ...basePayload("success"),
        auctionId: cmd.auctionId,
        listingId: cmd.listingId,
        expectedVersion,
      } as any);
    } catch {}

    return { ok: true, value };
  } catch (e: any) {
    const repoCode = typeof e?.code === "string" ? e.code : "REPOSITORY_ERROR";
    const repoMsg = typeof e?.message === "string" ? e.message : "Repository applyMechanicsPatch failed";

    let mapped: OrchestrationError;
    let event: "version_conflict" | "precondition_failed" | "repo_error" = "repo_error";

    if (repoCode === "VERSION_CONFLICT") {
      mapped = orchErr("VERSION_CONFLICT", repoMsg, { cause: e });
      event = "version_conflict";
    } else if (repoCode === "PRECONDITION_FAILED") {
      mapped = orchErr("PRECONDITION_FAILED", repoMsg, { cause: e });
      event = "precondition_failed";
    } else if (repoCode === "NOT_FOUND") {
      mapped = orchErr("NOT_FOUND", repoMsg, { cause: e });
      event = "not_found" as any;
    } else {
      mapped = orchErr("REPOSITORY_ERROR", repoMsg, { cause: e });
      event = "repo_error";
    }

    try {
      deps.logger.warn(orchEvent(op, event), {
        ...basePayload(
          event === "version_conflict"
            ? "version_conflict"
            : event === "precondition_failed"
              ? "precondition_failed"
              : event === ("not_found" as any)
                ? "not_found"
                : "repo_error"
        ),
        auctionId: cmd.auctionId,
        listingId: cmd.listingId,
        expectedVersion,
        error: { code: mapped.code, message: mapped.message },
      } as any);
    } catch {}

    return { ok: false, error: mapped };
  }
}
