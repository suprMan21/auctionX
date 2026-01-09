import { z } from "zod";
import { PreconditionsSchema } from "./orchestration.types";

// Authoritative domain schemas
import { AuctionSchema } from "../../schemas/domain/auction.schema";
import { BidSchema } from "../../schemas/domain/bid.schema";

/**
 * Orchestration input: minimal command payload.
 * (No HTTP concerns here; handlers can wrap later.)
 */
export const PlaceBidCommandSchema = z.object({
  auctionId: z.string().min(1),
  bidderUserId: z.string().min(1),
  amountCents: z.number().int().positive(),

  /**
   * Optional idempotency key. (No infra changes; just a slot.)
   * If your repo/mechanics already support dedupe later, this becomes useful.
   */
  idempotencyKey: z.string().min(1).optional(),
});
export type PlaceBidCommand = z.infer<typeof PlaceBidCommandSchema>;

/**
 * Mechanics output schema:
 * - patch: domain-specific (unknown to orchestration core; validated here)
 * - preconditions: structured & enforced by repo
 *
 * NOTE: The patch schema here must match whatever Module 02 mechanics returns.
 * If your mechanics already exports a PatchSchema, replace this with that export.
 */
export const AuctionPatchSchema = z.unknown(); // intentionally unknown until wired to mechanics patch type
export type AuctionPatch = z.infer<typeof AuctionPatchSchema>;

export const PlaceBidMechanicsResultSchema = z.object({
  patch: AuctionPatchSchema,
  preconditions: PreconditionsSchema,
  // Optionally allow mechanics to explicitly indicate no-op
  noop: z.boolean().optional(),
});
export type PlaceBidMechanicsResult = z.infer<typeof PlaceBidMechanicsResultSchema>;

/**
 * Output shape: updated auction + (optional) created bid.
 * If Module 02 stores bids separately, orchestration can return both.
 */
export const PlaceBidResultSchema = z.object({
  auction: AuctionSchema,
  bid: BidSchema.optional(),
});
export type PlaceBidResult = z.infer<typeof PlaceBidResultSchema>;
