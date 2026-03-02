import { z } from "zod";
import { DocIdSchema } from "./common.schema";

/**
 * AuctionState is the mutable mechanics state for an auction.
 * It is intentionally separated from Auction (schedule/snapshot) to keep Auction query-friendly.
 *
 * Path:
 * listings/{listingId}/auctions/{auctionId}/state/current
 */
export const MoneyCentsSchema = z.number().int().nonnegative();

export const AuctionProxyStateSchema = z.object({
  highBidderUid: z.string().min(1).nullable(),
  highBidderMaxCents: MoneyCentsSchema.nullable(),
  secondHighestMaxCents: MoneyCentsSchema.nullable(),
});

export const AuctionPricingStateSchema = z.object({
  startPriceCents: MoneyCentsSchema,
  currentPriceCents: MoneyCentsSchema,
});

export const AuctionCloseStateSchema = z
  .object({
    closedAtMs: z.number().int().nonnegative(),
    winnerUid: z.string().min(1).nullable(),
    winningPriceCents: MoneyCentsSchema,
    reason: z.enum(["TIME_ELAPSED", "NO_BIDS"]).optional(),
  })
  .optional();

export const AuctionStateSchema = z.object({
  listingId: DocIdSchema,
  auctionId: DocIdSchema,

  /**
   * Optimistic concurrency token for mechanics.
   * Mechanics preconditions.expectedVersion maps to this version.
   */
  version: z.number().int().nonnegative(),

  /**
   * Mechanics clock (ms) — deterministic services pass nowMs explicitly.
   */
  updatedAtMs: z.number().int().nonnegative(),

  pricing: AuctionPricingStateSchema,
  proxy: AuctionProxyStateSchema,

  close: AuctionCloseStateSchema,
});

export type AuctionState = z.infer<typeof AuctionStateSchema>;
