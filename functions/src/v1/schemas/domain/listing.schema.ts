import { z } from "zod";
import { BaseMetaSchema, DocIdSchema } from "./common.schema";
import { CurrencySchema, ItemConditionSchema, ListingStatusSchema } from "./enums.schema";

/**
 * Listing is the enduring entity across relists (locked decision).
 * Auctions will be modeled as a subcollection under the listing.
 */

export const ListingPhotoSchema = z.object({
  storagePath: z.string().min(1),
  url: z.string().url().optional(),

  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export const ListingLocationSchema = z.object({
  country: z.string().min(2).max(2).default("CA"),
  region: z.string().min(1).max(64), // province/state
  city: z.string().min(1).max(64),
  postalFsa: z.string().min(3).max(3).optional(), // Canada FSA (e.g., "M5V")
});

export const ListingPricingSchema = z.object({
  currency: CurrencySchema.default("CAD"),
  reservePriceCents: z.number().int().nonnegative().optional(),
});

export const ListingFlagsSchema = z.object({
  /**
   * Denormalized: derived from category.isAdult.
   * Stored for easier filtering/indexing.
   */
  adult: z.boolean().optional(),

  /**
   * Future: moderation pipeline.
   * This module is persistence-only; no enforcement.
   */
  requiresReview: z.boolean().optional(),
});

export const ListingSchema = BaseMetaSchema.extend({
  sellerUid: z.string().min(1),

  title: z.string().min(1).max(160),
  description: z.string().min(0).max(5000).optional(),

  categoryId: DocIdSchema,

  condition: ItemConditionSchema,

  photos: z.array(ListingPhotoSchema).default([]),

  location: ListingLocationSchema,

  pricing: ListingPricingSchema.default({ currency: "CAD" }),

  flags: ListingFlagsSchema.optional(),

  status: ListingStatusSchema.default("DRAFT"),
});

export type Listing = z.infer<typeof ListingSchema>;
