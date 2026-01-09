import { z } from "zod";

/**
 * Services are deterministic:
 * - no Date.now() inside business logic
 * - caller passes nowMs explicitly
 * Money uses integer cents.
 */

export const MoneyCentsSchema = z.number().int().nonnegative();
export type MoneyCents = z.infer<typeof MoneyCentsSchema>;

export const AuctionStatusSchema = z.enum(["SCHEDULED", "RUNNING", "CLOSED", "VOIDED"]);
export type AuctionStatus = z.infer<typeof AuctionStatusSchema>;

export const AuctionCoreSchema = z.object({
  id: z.string().min(1),
  listingId: z.string().min(1),

  status: AuctionStatusSchema,

  schedule: z.object({
    startAtMs: z.number().int().nonnegative(),
    endAtMs: z.number().int().nonnegative(),
  }),

  pricing: z.object({
    startPriceCents: MoneyCentsSchema,
    currentPriceCents: MoneyCentsSchema,
  }),

  version: z.number().int().nonnegative(),
  updatedAtMs: z.number().int().nonnegative(),

  proxy: z
    .object({
      highBidderUid: z.string().min(1).nullable(),
      highBidderMaxCents: MoneyCentsSchema.nullable(),
      secondHighestMaxCents: MoneyCentsSchema.nullable(),
    })
    .default({
      highBidderUid: null,
      highBidderMaxCents: null,
      secondHighestMaxCents: null,
    }),
});

export type AuctionCore = z.infer<typeof AuctionCoreSchema>;

export const PlaceBidInputSchema = z.object({
  bidderUid: z.string().min(1),
  maxCents: MoneyCentsSchema, // manual bid == max
});
export type PlaceBidInput = z.infer<typeof PlaceBidInputSchema>;

export const AuctionPatchSchema = z.object({
  status: AuctionStatusSchema.optional(),
  pricing: z
    .object({
      currentPriceCents: MoneyCentsSchema.optional(),
    })
    .optional(),
  proxy: z
    .object({
      highBidderUid: z.string().min(1).nullable().optional(),
      highBidderMaxCents: MoneyCentsSchema.nullable().optional(),
      secondHighestMaxCents: MoneyCentsSchema.nullable().optional(),
    })
    .optional(),
  close: z
    .object({
      closedAtMs: z.number().int().nonnegative(),
      winnerUid: z.string().min(1).nullable(),
      winningPriceCents: MoneyCentsSchema,
      reason: z.enum(["TIME_ELAPSED", "NO_BIDS"]).optional(),
    })
    .optional(),
  versionBump: z.literal(1),
});
export type AuctionPatch = z.infer<typeof AuctionPatchSchema>;

export const PreconditionsSchema = z.object({
  auctionId: z.string().min(1),
  expectedVersion: z.number().int().nonnegative(),
});
export type Preconditions = z.infer<typeof PreconditionsSchema>;

export const MechanicsOutputSchema = z.object({
  preconditions: PreconditionsSchema,
  patch: AuctionPatchSchema,
});
export type MechanicsOutput = z.infer<typeof MechanicsOutputSchema>;
