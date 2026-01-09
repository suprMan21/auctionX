import { z } from "zod";
import { orchEvent, OrchestrationLogger } from "./orchestration.logging";
import { orchErr, OrchestrationError } from "./orchestration.errors";
import type { ApplyPatchArgs, RepoApplyPatchResult, RepoReadResult } from "./orchestration.types";
import { PreconditionsSchema, VersionTokenSchema } from "./orchestration.types";

import {
  PlaceBidCommandSchema,
  PlaceBidMechanicsResultSchema,
  PlaceBidResultSchema,
  type PlaceBidCommand,
  type PlaceBidMechanicsResult,
  type PlaceBidResult,
  type AuctionPatch,
} from "./auction.orchestrator.schemas";

// Authoritative domain schema/type (for typing only)
import type { z as zType } from "zod";
import { AuctionSchema } from "../../schemas/domain/auction.schema";

// Mechanics (pure/deterministic)
// NOTE: Adjust import to your actual mechanics export names without changing mechanics code.
import { runProxyBidMechanics } from "../auctions/auction.mechanics";

export type Auction = z.infer<typeof AuctionSchema>;

/**
 * Repository ports (interfaces) for testability.
 * Adapt your existing repos to these interfaces at composition time.
 */
export type AuctionsRepoPort = {
  getById: (auctionId: string) => Promise<RepoReadResult<Auction> | null>;
  applyPatch: (auctionId: string, args: ApplyPatchArgs<AuctionPatch>) => Promise<RepoApplyPatchResult<Auction>>;
};

export type BidsRepoPort = {
  // Optional: if bids are persisted separately
  // create: (bid: unknown, expectedVersion?: unknown) => Promise<unknown>;
};

export type PlaceBidDeps = {
  auctionsRepo: AuctionsRepoPort;
  bidsRepo?: BidsRepoPort;
  logger: OrchestrationLogger;

  /**
   * requestId should come from your request context (already canonical).
   * Keep it explicit for unit testing and non-HTTP future invocations.
   */
  requestId: string;
};

const safeNow = () => Date.now();

/**
 * placeBid orchestration:
 * - validates input
 * - loads auction (repo)
 * - runs pure mechanics (no side effects)
 * - validates mechanics output
 * - applies patch (repo) with expectedVersion + preconditions
 * - logs attempt + terminal outcome
 */
export async function placeBid(deps: PlaceBidDeps, input: unknown): Promise<{ ok: true; value: PlaceBidResult } | { ok: false; error: OrchestrationError }> {
  const started = safeNow();
  const op = "placeBid";
  const basePayload = (outcome: any) => ({
    requestId: deps.requestId,
    op,
    aggregate: "auction",
    outcome,
    durationMs: safeNow() - started,
  });

  // attempt log (must not affect control flow)
  try {
    deps.logger.info(orchEvent(op, "attempt"), basePayload("success"));
  } catch {
    // ignore logging failures
  }

  // 1) Validate input
  let cmd: PlaceBidCommand;
  try {
    cmd = PlaceBidCommandSchema.parse(input);
  } catch (e) {
    const error = orchErr("VALIDATION_FAILED", "Invalid placeBid command input", { zodError: e });
    try {
      deps.logger.warn(orchEvent(op, "validation_failed"), {
        ...basePayload("validation_failed"),
        auctionId: (input as any)?.auctionId,
        actorId: (input as any)?.bidderUserId,
        error: { code: error.code, message: error.message },
      });
    } catch {}
    return { ok: false, error };
  }

  // 2) Load aggregate
  const found = await deps.auctionsRepo.getById(cmd.auctionId);
  if (!found) {
    const error = orchErr("NOT_FOUND", `Auction not found: ${cmd.auctionId}`);
    try {
      deps.logger.warn(orchEvent(op, "not_found"), {
        ...basePayload("not_found"),
        auctionId: cmd.auctionId,
        actorId: cmd.bidderUserId,
        error: { code: error.code, message: error.message },
      });
    } catch {}
    return { ok: false, error };
  }

  // Defensive validation of repo outputs (repos are authoritative, but we keep orchestration robust)
  const auction = AuctionSchema.parse(found.value);
  const expectedVersion = VersionTokenSchema.parse(found.version);

  // 3) Run pure mechanics
  // IMPORTANT: mechanics outputs must be treated as immutable artifacts.
  let mechanicsOut: PlaceBidMechanicsResult;
  try {
    const raw = await runProxyBidMechanics({
      auction,
      bidderUserId: cmd.bidderUserId,
      amountCents: cmd.amountCents,
      idempotencyKey: cmd.idempotencyKey,
    });

    // 4) Validate mechanics output (patch + preconditions)
    mechanicsOut = PlaceBidMechanicsResultSchema.parse(raw);

    // Ensure preconditions are structurally valid even if mechanics schema changes
    PreconditionsSchema.parse(mechanicsOut.preconditions);

    // Optional: freeze to protect against accidental mutation downstream
    Object.freeze(mechanicsOut);
  } catch (e) {
    const error = orchErr("UNEXPECTED_ERROR", "Mechanics execution failed", { cause: e });
    try {
      deps.logger.error(orchEvent(op, "unexpected_error"), {
        ...basePayload("unexpected_error"),
        auctionId: cmd.auctionId,
        actorId: cmd.bidderUserId,
        expectedVersion,
        error: { code: error.code, message: error.message },
      });
    } catch {}
    return { ok: false, error };
  }

  // 5) If mechanics indicates no-op, return unchanged auction (still deterministic)
  if (mechanicsOut.noop) {
    const value: PlaceBidResult = PlaceBidResultSchema.parse({ auction });
    try {
      deps.logger.info(orchEvent(op, "noop"), {
        ...basePayload("noop"),
        auctionId: cmd.auctionId,
        actorId: cmd.bidderUserId,
        expectedVersion,
      });
    } catch {}
    return { ok: true, value };
  }

  // 6) Apply patch with optimistic concurrency + preconditions
  try {
    const applied = await deps.auctionsRepo.applyPatch(cmd.auctionId, {
      expectedVersion,
      preconditions: mechanicsOut.preconditions,
      patch: mechanicsOut.patch,
    });

    const updatedAuction = AuctionSchema.parse(applied.value);

    const value: PlaceBidResult = PlaceBidResultSchema.parse({
      auction: updatedAuction,
      // bid: optional (only if your current flow persists bids separately)
    });

    try {
      deps.logger.info(orchEvent(op, "success"), {
        ...basePayload("success"),
        auctionId: cmd.auctionId,
        actorId: cmd.bidderUserId,
        expectedVersion,
      });
    } catch {}

    return { ok: true, value };
  } catch (e: any) {
    /**
     * Repo is responsible for:
     * - expectedVersion enforcement
     * - re-checking preconditions against current stored state
     *
     * To keep deterministic behavior, we translate known repo failure modes
     * into stable orchestration errors, but we do not attempt retries here.
     */
    const repoCode = typeof e?.code === "string" ? e.code : "REPOSITORY_ERROR";
    const repoMsg = typeof e?.message === "string" ? e.message : "Repository applyPatch failed";

    // Suggested mapping: your repos may already throw standard errors; adjust mapping by code later.
    let mapped: OrchestrationError;
    let event: "version_conflict" | "precondition_failed" | "repo_error" = "repo_error";

    if (repoCode === "VERSION_CONFLICT" || repoCode === "OPTIMISTIC_CONCURRENCY_FAILED") {
      mapped = orchErr("VERSION_CONFLICT", repoMsg, { cause: e });
      event = "version_conflict";
    } else if (repoCode === "PRECONDITION_FAILED") {
      mapped = orchErr("PRECONDITION_FAILED", repoMsg, { cause: e });
      event = "precondition_failed";
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
              : "repo_error"
        ),
        auctionId: cmd.auctionId,
        actorId: cmd.bidderUserId,
        expectedVersion,
        error: { code: mapped.code, message: mapped.message },
      });
    } catch {}

    return { ok: false, error: mapped };
  }
}
