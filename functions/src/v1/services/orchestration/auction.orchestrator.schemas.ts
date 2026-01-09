import { z } from "zod";

// Canonical mechanics schemas/types (authoritative)
import { PlaceBidInputSchema, MechanicsOutputSchema, AuctionCoreSchema } from "../auctions/auction.types";

export const PlaceBidCommandSchema = z.object({
  listingId: z.string().min(1),
  auctionId: z.string().min(1),
  bidderUserId: z.string().min(1),
  amountCents: z.number().int().positive(),
  nowMs: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1).optional(),
});
export type PlaceBidCommand = z.infer<typeof PlaceBidCommandSchema>;

export const PlaceBidInputForMechanicsSchema = PlaceBidInputSchema;
export type PlaceBidInputForMechanics = z.infer<typeof PlaceBidInputForMechanicsSchema>;

export const PlaceBidMechanicsOutputSchema = MechanicsOutputSchema;
export type PlaceBidMechanicsOutput = z.infer<typeof PlaceBidMechanicsOutputSchema>;

export const PlaceBidResultSchema = z.object({
  auction: AuctionCoreSchema,
});
export type PlaceBidResult = z.infer<typeof PlaceBidResultSchema>;
