import { z } from "zod";
import { BaseMetaSchema, DocIdSchema } from "./common.schema";
import { AuctionStatusSchema } from "./enums.schema";
import { FirestoreTimestampSchema } from "./common.schema";

/**
 * Auctions are persisted under a listing:
 * listings/{listingId}/auctions/{auctionId}
 *
 * This file defines persistence shape only.
 */

export const AuctionScheduleSchema = z.object({
  startAt: FirestoreTimestampSchema,
  endAt: FirestoreTimestampSchema,
});

export const AuctionCloseSchema = z.object({
  closedAt: FirestoreTimestampSchema.optional(),
  reason: z.string().max(240).optional(),
});

/**
 * Denormalized snapshot of listing fields useful for feed queries.
 * Keeps auctions query-friendly even if listing changes later.
 */
export const AuctionSnapshotSchema = z.object({
  title: z.string().min(1).max(160),
  categoryId: DocIdSchema,
  sellerUid: z.string().min(1),
});

export const AuctionSchema = BaseMetaSchema.extend({
  listingId: DocIdSchema,

  /**
   * Relist iteration: 0 = first run, 1..2 relists (locked max 2 relists).
   * We store the number; enforcement is later modules.
   */
  iteration: z.number().int().min(0).max(2).default(0),

  status: AuctionStatusSchema.default("SCHEDULED"),

  schedule: AuctionScheduleSchema,

  close: AuctionCloseSchema.optional(),

  snapshot: AuctionSnapshotSchema,
});

export type Auction = z.infer<typeof AuctionSchema>;
