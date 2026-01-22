import { z } from "zod";
import { BaseMetaSchema, DocIdSchema, FirestoreTimestampSchema } from "./common.schema";
import { CurrencySchema, ItemConditionSchema, ListingStatusSchema, BrandSchema, DEFAULT_CURRENCY } from "./enums.schema";

/**
 * Listing is the enduring entity across relists (locked decision).
 * Auctions will be modeled as a subcollection under the listing.
 */

/**
 * UPDATED: Media schema supporting both images and videos
 */
export const ListingMediaSchema = z.object({
  id: z.string().min(1), // uuid
  type: z.enum(["IMAGE", "VIDEO"]),
  
  // S3 storage
  s3Key: z.string().min(1), // e.g., "listings/l123/abc123.jpg"
  s3Bucket: z.string().min(1),
  
  // Public URLs (from CloudFront or S3)
  url: z.string().url(),
  thumbnailUrl: z.string().url().optional(), // for videos
  
  // Metadata
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSeconds: z.number().int().positive().optional(), // for videos
  sizeBytes: z.number().int().positive(),
  
  // Upload tracking
  uploadedAt: FirestoreTimestampSchema,
  
  // Display order
  sortOrder: z.number().int().nonnegative().default(0),
});

export type ListingMedia = z.infer<typeof ListingMediaSchema>;

export const ListingLocationSchema = z.object({
  country: z.string().min(2).max(2).default("CA"),
  region: z.string().min(1).max(64), // province/state
  city: z.string().min(1).max(64),
  postalFsa: z.string().min(3).max(3).optional(), // Canada FSA (e.g., "M5V")
});

export const ListingPricingSchema = z.object({
  currency: CurrencySchema.default(DEFAULT_CURRENCY),
  reservePriceCents: z.number().int().nonnegative().optional(),
});

export const ListingFlagsSchema = z.object({
  /**
   * DEPRECATED: Use brand field instead
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

  // UPDATED: Renamed from photos to media, supports images + videos
  media: z.array(ListingMediaSchema).max(10).default([]),

  location: ListingLocationSchema,

  pricing: ListingPricingSchema.default({ currency: DEFAULT_CURRENCY }),

  flags: ListingFlagsSchema.optional(),
  
  // NEW: Brand tracking
  brand: BrandSchema,

  status: ListingStatusSchema.default("DRAFT"),
});

export type Listing = z.infer<typeof ListingSchema>;
