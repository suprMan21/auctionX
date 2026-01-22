import { z } from "zod";

/**
 * NOTE: These are persistence-state enums (not business logic).
 * They should be stable, backward-compatible, and safe for filtering/indexing.
 */

export const CurrencySchema = z.enum(["CAD", "USD"]);
export type Currency = z.infer<typeof CurrencySchema>;

export const DEFAULT_CURRENCY = "CAD" as const;

export const ListingStatusSchema = z.enum(["DRAFT", "ACTIVE", "SUSPENDED", "ARCHIVED"]);
export type ListingStatus = z.infer<typeof ListingStatusSchema>;

export const AuctionStatusSchema = z.enum(["SCHEDULED", "RUNNING", "CLOSED", "VOIDED"]);
export type AuctionStatus = z.infer<typeof AuctionStatusSchema>;

export const BidStatusSchema = z.enum(["PLACED", "OUTBID", "WINNING", "RETRACTED"]);
export type BidStatus = z.infer<typeof BidStatusSchema>;

/**
 * Minimal condition enum for physical goods.
 * Expand later without breaking persisted values.
 */
export const ItemConditionSchema = z.enum([
  "NEW",
  "LIKE_NEW",
  "GOOD",
  "FAIR",
  "POOR",
]);
export type ItemCondition = z.infer<typeof ItemConditionSchema>;

/**
 * Payment processor enum for dual-processor architecture
 */
export const PaymentProcessorSchema = z.enum([
  "STRIPE",      // AuctionX (SFW)
  "SEGPAY",      // Unmentionables (NSFW)
]);
export type PaymentProcessor = z.infer<typeof PaymentProcessorSchema>;

/**
 * Brand/marketplace enum
 */
export const BrandSchema = z.enum([
  "AUCTIONX",        // SFW marketplace
  "UNMENTIONABLES",  // NSFW marketplace
]);
export type Brand = z.infer<typeof BrandSchema>;
