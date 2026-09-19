/**
 * Request validation for the S-NFC3 tag-management endpoints.
 *
 * Every endpoint validates with Zod before touching the database (project code
 * style: Zod schemas for all validation). `.strict()` throughout so an
 * unexpected field is a 400 rather than a silently ignored one — these are
 * ownership-mutating routes.
 */

import { z } from 'zod';

const uuid = z.string().uuid();

/** A SUN scan presented by the holder: the tapped URL plus the chip UID. */
const sunScan = z.object({
  tagUid: z.string().min(1).max(32),
  sunMessage: z.string().min(1).max(2048),
});

export const enrollSchema = z.object({
  tagUid: z.string().min(1).max(32),
  aesKey: z.string().regex(/^[0-9a-fA-F]{32}$/, 'aesKey must be 16 bytes of hex'),
  tenantId: z.string().min(1).max(64).optional(),
  itemId: uuid.optional(),
}).strict();

/**
 * Origin claim. Requires a fresh SUN scan: claiming is the moment ownership
 * binds, so possession of the physical chip must be proven, not asserted.
 */
export const claimSchema = sunScan.extend({}).strict();

export const transferInitiateSchema = z.object({
  tagId: uuid,
  transferType: z.enum(['sale', 'gift']),
  /** Exactly one target. An email target may have no account yet (Rule 3). */
  toUserId: uuid.optional(),
  toEmail: z.string().email().max(320).optional(),
  /** Recipient pays by default; the sender may absorb it (Rule 4). */
  feePayer: z.enum(['BUYER', 'SELLER']).default('BUYER'),
}).strict().refine(
  (v) => (v.toUserId === undefined) !== (v.toEmail === undefined),
  { message: 'Provide exactly one of toUserId or toEmail' },
);

export const transferCompleteSchema = sunScan.extend({}).strict();

export const releaseSchema = z.object({
  tagId: uuid,
  /**
   * Second confirmation (Rule 6). Release is terminal and irreversible, so the
   * API refuses to act on a single unconfirmed call even if a UI forgets to
   * double-confirm.
   */
  confirm: z.literal(true),
  confirmPhrase: z.literal('RELEASE'),
}).strict();

export const replaceSchema = z.object({
  oldTagId: uuid,
  /** Must already be ENROLLED and unclaimed. */
  newTagId: uuid,
}).strict();

export const reissueRequestSchema = z.object({
  tagId: uuid,
}).strict();

export const disclosureSchema = z.object({
  origin_video: z.boolean().optional(),
  creator_name: z.boolean().optional(),
  claim_date: z.boolean().optional(),
  location: z.boolean().optional(),
}).strict().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'At least one disclosure field is required' },
);

export type DisclosureInput = z.infer<typeof disclosureSchema>;
export const DISCLOSURE_FIELDS = [
  'origin_video',
  'creator_name',
  'claim_date',
  'location',
] as const;
