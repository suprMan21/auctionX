import { z } from "zod";
import { AuctionCoreSchema } from "../auctions/auction.types";
import { CloseAuctionOutcomeSchema, CloseAuctionResultSchema, OfferCascadeResultSchema } from "./auction.close.types";

export const CloseAuctionCommandSchema = z.object({
  listingId: z.string().min(1),
  auctionId: z.string().min(1),
  nowMs: z.number().int().nonnegative(),
});

export type CloseAuctionCommand = z.infer<typeof CloseAuctionCommandSchema>;

export const CloseAuctionResultOutSchema = CloseAuctionResultSchema.extend({
  auction: AuctionCoreSchema,
  outcome: CloseAuctionOutcomeSchema,
});

export type CloseAuctionResultOut = z.infer<typeof CloseAuctionResultOutSchema>;

export const OfferCascadeCommandSchema = z.object({
  listingId: z.string().min(1),
  auctionId: z.string().min(1),
  nowMs: z.number().int().nonnegative(),
  excludeBidderUids: z.array(z.string().min(1)).default([]),
});

export type OfferCascadeCommand = z.infer<typeof OfferCascadeCommandSchema>;

export const OfferCascadeResultOutSchema = OfferCascadeResultSchema;

export type OfferCascadeResultOut = z.infer<typeof OfferCascadeResultOutSchema>;
