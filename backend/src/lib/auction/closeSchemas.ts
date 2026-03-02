/**
 * @module Module 02 Port — Auction Mechanics
 * Command and result schemas for close-auction and offer-cascade operations.
 * Ported from functions/src/v1/services/orchestration/auction.close.schemas.ts
 */

import { z } from "zod";
import { AuctionCoreSchema } from "./types";
import { CloseAuctionOutcomeSchema, CloseAuctionResultSchema, OfferCascadeResultSchema } from "./closeTypes";

/** Input command for the closeAuction orchestrator. */
export const CloseAuctionCommandSchema = z.object({
  listingId: z.string().min(1),
  auctionId: z.string().min(1),
  nowMs: z.number().int().nonnegative(),
});

export type CloseAuctionCommand = z.infer<typeof CloseAuctionCommandSchema>;

/** Fully-typed close result (auction field narrowed to AuctionCore). */
export const CloseAuctionResultOutSchema = CloseAuctionResultSchema.extend({
  auction: AuctionCoreSchema,
  outcome: CloseAuctionOutcomeSchema,
});

export type CloseAuctionResultOut = z.infer<typeof CloseAuctionResultOutSchema>;

/** Input command for the offerCascade orchestrator. */
export const OfferCascadeCommandSchema = z.object({
  listingId: z.string().min(1),
  auctionId: z.string().min(1),
  nowMs: z.number().int().nonnegative(),
  excludeBidderUids: z.array(z.string().min(1)).default([]),
});

export type OfferCascadeCommand = z.infer<typeof OfferCascadeCommandSchema>;

export const OfferCascadeResultOutSchema = OfferCascadeResultSchema;
export type OfferCascadeResultOut = z.infer<typeof OfferCascadeResultOutSchema>;
