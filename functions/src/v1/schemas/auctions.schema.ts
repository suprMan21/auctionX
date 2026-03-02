import { z } from "zod";
import { AuctionSchema } from "./domain/auction.schema";

export const AuctionIdParamSchema = z.object({
  auctionId: z.string().min(1),
});

export const ListAuctionsQuerySchema = z.object({
  status: z.string().optional(),
  categoryId: z.string().optional(),
  sellerUid: z.string().optional(),

  // MVP-safe pagination knobs (optional)
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const AuctionGetResponseSchema = z.object({
  data: AuctionSchema,
});

export const AuctionListResponseSchema = z.object({
  data: z.array(AuctionSchema),
  meta: z.object({
    nextCursor: z.string().optional(),
  }),
});
