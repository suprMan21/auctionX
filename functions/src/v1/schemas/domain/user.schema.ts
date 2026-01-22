import { z } from "zod";
import { FirestoreTimestampSchema } from "./common.schema";

/**
 * Base user shape (persistence).
 * No auth enforcement or claims mapping here.
 */

/**
 * Shipping address schema
 */
export const ShippingAddressSchema = z.object({
  id: z.string().min(1), // uuid
  name: z.string().min(1).max(120),
  addressLine1: z.string().min(1).max(200),
  addressLine2: z.string().max(200).optional(),
  city: z.string().min(1).max(100),
  region: z.string().min(1).max(100), // state/province
  postalCode: z.string().min(1).max(20),
  country: z.string().min(2).max(2), // ISO country code
  phoneNumber: z.string().min(4).max(32).optional(),
  isDefault: z.boolean().default(false),
});

export type ShippingAddress = z.infer<typeof ShippingAddressSchema>;

/**
 * Verification status schema
 */
export const VerificationStatusSchema = z.object({
  age: z.object({
    verified: z.boolean().default(false),
    verifiedAt: FirestoreTimestampSchema.optional(),
    provider: z.enum(["YOTI"]).optional(),
  }).optional(),
  
  seller: z.object({
    status: z.enum(["NONE", "PENDING", "APPROVED", "REJECTED"]).default("NONE"),
    submittedAt: FirestoreTimestampSchema.optional(),
    reviewedAt: FirestoreTimestampSchema.optional(),
    rejectionReason: z.string().max(500).optional(),
  }).optional(),
});

export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

/**
 * Seller tier schema
 */
export const SellerTierSchema = z.object({
  current: z.enum(["TIER_1", "TIER_2", "TIER_3"]).default("TIER_1"),
  lifetimeSalesCents: z.number().int().nonnegative().default(0),
  last12MonthsSalesCents: z.number().int().nonnegative().default(0),
  tierAchievedAt: FirestoreTimestampSchema.optional(),
});

export type SellerTier = z.infer<typeof SellerTierSchema>;

/**
 * Moderation status schema
 */
export const ModerationStatusSchema = z.object({
  isBanned: z.boolean().default(false),
  bannedAt: FirestoreTimestampSchema.optional(),
  bannedUntil: FirestoreTimestampSchema.optional(), // null = permanent
  banReason: z.string().max(500).optional(),
  
  isSuspended: z.boolean().default(false),
  suspendedAt: FirestoreTimestampSchema.optional(),
  suspendedUntil: FirestoreTimestampSchema.optional(),
  suspensionReason: z.string().max(500).optional(),
  
  warnings: z.number().int().nonnegative().default(0),
});

export type ModerationStatus = z.infer<typeof ModerationStatusSchema>;

/**
 * Custom claims for Firebase Auth
 */
export const CustomClaimsSchema = z.object({
  // Admin hierarchy
  super_admin: z.boolean().optional(),    // Platform owner
  admin: z.boolean().optional(),          // Full admin access
  moderator: z.boolean().optional(),      // Moderation queues only
  support: z.boolean().optional(),        // Support tickets only
  finance: z.boolean().optional(),        // Financial reports only
  
  // Seller status
  verified_seller: z.boolean().optional(),  // Approved to sell
  
  // User status
  age_verified: z.boolean().optional(),     // Can access NSFW content
  banned: z.boolean().optional(),           // Account banned
});

export type CustomClaims = z.infer<typeof CustomClaimsSchema>;

/**
 * Deprecated - keeping for backward compatibility
 */
export const UserRolesSchema = z.object({
  admin: z.boolean().optional(),
  moderator: z.boolean().optional(),
});

export const UserSchema = z.object({
  uid: z.string().min(1),

  displayName: z.string().min(1).max(120).optional(),
  photoURL: z.string().url().optional(),

  email: z.string().email().optional(),
  phoneNumber: z.string().min(4).max(32).optional(),

  // DEPRECATED: Use custom claims instead
  roles: UserRolesSchema.optional(),
  
  // NEW: Shipping addresses
  shippingAddresses: z.array(ShippingAddressSchema).default([]),
  
  // NEW: Verification status
  verification: VerificationStatusSchema.optional(),
  
  // NEW: Seller tier information
  sellerTier: SellerTierSchema.optional(),
  
  // NEW: Moderation status
  moderation: ModerationStatusSchema.optional(),

  createdAt: FirestoreTimestampSchema,
  updatedAt: FirestoreTimestampSchema,
});

export type User = z.infer<typeof UserSchema>;
