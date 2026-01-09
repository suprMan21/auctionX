import { z } from "zod";

// Canonical mechanics schemas/types (authoritative)
import {
  PlaceBidInputSchema,
  MechanicsOutputSchema,
  AuctionCoreSchema,
} from "../auctions/auction.types";

export const PlaceBidCommandSchema = z.object({
  auctionId: z.string().min(1),
  bidderUserId: z.string().min(1),
  amountCents: z.number().int().positive(),
  nowMs: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1).optional(),
});
export type PlaceBidCommand = z.infer<typeof PlaceBidCommandSchema>;

/**
 * Orchestration uses the canonical shapes from auction.types.
 */
export const PlaceBidInputForMechanicsSchema = PlaceBidInputSchema;
export type PlaceBidInputForMechanics = z.infer<typeof PlaceBidInputForMechanicsSchema>;

export const PlaceBidMechanicsOutputSchema = MechanicsOutputSchema;
export type PlaceBidMechanicsOutput = z.infer<typeof PlaceBidMechanicsOutputSchema>;

/**
 * Orchestration result (no HTTP concerns).
 * For now: updated auction only.
 */
export const PlaceBidResultSchema = z.object({
  auction: AuctionCoreSchema,
});
export type PlaceBidResult = z.infer<typeof PlaceBidResultSchema>;
