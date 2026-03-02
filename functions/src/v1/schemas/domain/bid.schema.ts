import { z } from "zod";
import { DocIdSchema, FirestoreTimestampSchema } from "./common.schema";
import { BidStatusSchema, CurrencySchema } from "./enums.schema";

/**
 * Bids are persisted under an auction:
 * listings/{listingId}/auctions/{auctionId}/bids/{bidId}
 *
 * No mechanics, no proxy rules, no winner determination here.
 */

export const BidSchema = z.object({
  id: DocIdSchema,

  listingId: DocIdSchema,
  auctionId: DocIdSchema,

  bidderUid: z.string().min(1),

  amountCents: z.number().int().positive(),
  currency: CurrencySchema.default("CAD"),

  status: BidStatusSchema.default("PLACED"),

  placedAt: FirestoreTimestampSchema,

  /**
   * Optional idempotency key, useful at persistence boundary
   * (e.g., retries from clients/handlers).
   */
  clientRequestId: z.string().min(1).max(128).optional(),
});

export type Bid = z.infer<typeof BidSchema>;
