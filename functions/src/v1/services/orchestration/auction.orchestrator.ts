import { orchEvent, type OrchestrationLogger } from "./orchestration.logging";
import { orchErr, type OrchestrationError } from "./orchestration.errors";
import type { RepoReadResult, RepoApplyPatchResult } from "./orchestration.types";
import { VersionTokenSchema } from "./orchestration.types";

import {
  PlaceBidCommandSchema,
  PlaceBidInputForMechanicsSchema,
  PlaceBidMechanicsOutputSchema,
  PlaceBidResultSchema,
  type PlaceBidResult,
} from "./auction.orchestrator.schemas";

// Canonical auction schemas/types (authoritative)
import { AuctionCoreSchema, PreconditionsSchema, AuctionPatchSchema } from "../auctions/auction.types";
import type { AuctionCore, Preconditions, AuctionPatch } from "../auctions/auction.types";

// Mechanics (pure/deterministic)
import { computePlaceBid } from "../auctions/auction.mechanics";
import type { AuctionMechanicsError } from "../auctions/auction.errors";

/**
 * Repo port for transactional patch application.
 * NOTE: VersionToken here represents the persisted auction version at read time.
 * In our system, it will be the numeric auction.version.
 */
export type AuctionsRepoPort = {
  getCore: (listingId: string, auctionId: string) => Promise<RepoReadResult<AuctionCore> | null>;
  applyMechanicsPatch: (args: {
    listingId: string;
    auctionId: string;
    expectedVersion: number;
    preconditions: Preconditions;
    patch: AuctionPatch;
    nowMs: number;
  }) => Promise<RepoApplyPatchResult<AuctionCore>>;
};

export type PlaceBidDeps = {
  auctionsRepo: AuctionsRepoPort;
  logger: OrchestrationLogger;
  requestId: string;
};

/**
 * Determinism note:
 * - Business outcomes must not depend on wall clock.
 * - For strictness, orchestration logs durationMs as 0.
 */
const durationMs = () => 0;

export async function placeBid(
  deps: PlaceBidDeps,
  input: unknown
): Promise<{ ok: true; value: PlaceBidResult } | { ok: false; error: OrchestrationError }> {
  const op = "placeBid";

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

  // 1) Validate command
  let cmd: {
    listingId: string;
    auctionId: string;
    bidderUserId: string;
    amountCents: number;
    nowMs: number;
    idempotencyKey?: string;
  };

  try {
    cmd = PlaceBidCommandSchema.parse(input);
  } catch (e) {
    const error = orchErr("VALIDATION_FAILED", "Invalid placeBid command input", { zodError: e });
    try {
      deps.logger.warn(orchEvent(op, "validation_failed"), {
        ...basePayload("validation_failed"),
        auctionId: (input as any)?.auctionId,
        listingId: (input as any)?.listingId,
        actorId: (input as any)?.bidderUserId,
        error: { code: error.code, message: error.message },
      } as any);
    } catch {}
    return { ok: false, error };
  }

  // 2) Load auction core
  const found = await deps.auctionsRepo.getCore(cmd.listingId, cmd.auctionId);
  if (!found) {
    const error = orchErr("NOT_FOUND", `Auction not found: ${cmd.listingId}/${cmd.auctionId}`);
    try {
      deps.logger.warn(orchEvent(op, "not_found"), {
        ...basePayload("not_found"),
        auctionId: cmd.auctionId,
        listingId: cmd.listingId,
        actorId: cmd.bidderUserId,
        error: { code: error.code, message: error.message },
      } as any);
    } catch {}
    return { ok: false, error };
  }

  const auction = AuctionCoreSchema.parse(found.value);

  // persisted version should match auction.version, but keep tolerant:
  const readVersion = VersionTokenSchema.parse(found.version);
  const expectedVersion = typeof readVersion === "number" ? readVersion : auction.version;

  // 3) Build mechanics input
  const mechanicsInput = PlaceBidInputForMechanicsSchema.parse({
    bidderUid: cmd.bidderUserId,
    maxCents: cmd.amountCents,
  });

  // 4) Run mechanics
  const result = computePlaceBid({
    auction,
    input: mechanicsInput,
    nowMs: cmd.nowMs,
  });

  if (!result.ok) {
    const ae = result.error as AuctionMechanicsError;
    const error = orchErr(ae.code ?? "UNEXPECTED_ERROR", ae.message ?? "Mechanics rejected bid", {
      details: (ae as any).details,
    });

    try {
      deps.logger.warn(orchEvent(op, "precondition_failed"), {
        ...basePayload("precondition_failed"),
        auctionId: cmd.auctionId,
        listingId: cmd.listingId,
        actorId: cmd.bidderUserId,
        expectedVersion,
        error: { code: error.code, message: error.message },
      } as any);
    } catch {}

    return { ok: false, error };
  }

  const mechanicsOut = PlaceBidMechanicsOutputSchema.parse(result.value);

  // Defensive immutability guard
  Object.freeze(mechanicsOut);
  Object.freeze(mechanicsOut.patch);
  Object.freeze(mechanicsOut.preconditions);

  const patch = AuctionPatchSchema.parse(mechanicsOut.patch);
  const pre = PreconditionsSchema.parse(mechanicsOut.preconditions);

  // 5) Apply patch transactionally
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

    const value = PlaceBidResultSchema.parse({ auction: updatedAuction });

    try {
      deps.logger.info(orchEvent(op, "success"), {
        ...basePayload("success"),
        auctionId: cmd.auctionId,
        listingId: cmd.listingId,
        actorId: cmd.bidderUserId,
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
        actorId: cmd.bidderUserId,
        expectedVersion,
        error: { code: mapped.code, message: mapped.message },
      } as any);
    } catch {}

    return { ok: false, error: mapped };
  }
}
