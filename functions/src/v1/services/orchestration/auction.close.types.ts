import { z } from "zod";

export const PaymentReadyIntentSchema = z.object({
  kind: z.literal("PAYMENT_REQUIRED"),
  listingId: z.string().min(1),
  auctionId: z.string().min(1),

  buyerUid: z.string().min(1),
  sellerUid: z.string().min(1),

  amountCents: z.number().int().nonnegative(),
  currency: z.literal("CAD").default("CAD"),

  reservePriceCents: z.number().int().nonnegative().nullable().optional(),

  reason: z.enum(["WINNER_AT_CLOSE", "CASCADE_OFFER"]).default("WINNER_AT_CLOSE"),
});

export type PaymentReadyIntent = z.infer<typeof PaymentReadyIntentSchema>;

export const CloseAuctionOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("NO_BIDS"),
    listingId: z.string().min(1),
    auctionId: z.string().min(1),
    closedAtMs: z.number().int().nonnegative(),
  }),

  z.object({
    kind: z.literal("RESERVE_NOT_MET"),
    listingId: z.string().min(1),
    auctionId: z.string().min(1),
    closedAtMs: z.number().int().nonnegative(),
    winnerUid: z.string().min(1),
    winningPriceCents: z.number().int().nonnegative(),
    reservePriceCents: z.number().int().nonnegative(),
  }),

  PaymentReadyIntentSchema,
]);

export type CloseAuctionOutcome = z.infer<typeof CloseAuctionOutcomeSchema>;

export const CloseAuctionResultSchema = z.object({
  auction: z.any(),
  close: z.object({
    closedAtMs: z.number().int().nonnegative(),
    winnerUid: z.string().min(1).nullable(),
    winningPriceCents: z.number().int().nonnegative(),
    reason: z.enum(["TIME_ELAPSED", "NO_BIDS"]),
  }),
  outcome: CloseAuctionOutcomeSchema,
});

export type CloseAuctionResult = z.infer<typeof CloseAuctionResultSchema>;

export const OfferCascadeOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("NO_ELIGIBLE_BIDDERS"),
    listingId: z.string().min(1),
    auctionId: z.string().min(1),
    closedAtMs: z.number().int().nonnegative().optional(),
  }),
  PaymentReadyIntentSchema.extend({
    reason: z.literal("CASCADE_OFFER"),
  }),
]);

export type OfferCascadeOutcome = z.infer<typeof OfferCascadeOutcomeSchema>;

export const OfferCascadeResultSchema = z.object({
  listingId: z.string().min(1),
  auctionId: z.string().min(1),
  outcome: OfferCascadeOutcomeSchema,
  computed: z
    .object({
      nextWinnerUid: z.string().min(1).nullable().optional(),
      offerPriceCents: z.number().int().nonnegative().optional(),
      excludedUids: z.array(z.string().min(1)).default([]),
    })
    .optional(),
});

export type OfferCascadeResult = z.infer<typeof OfferCascadeResultSchema>;
