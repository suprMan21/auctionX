/**
 * S-ADMIN1 — request validation for the token admin console
 * (/api/v1/admin/tags). Zod first, `.strict()` on every body: these routes move
 * ownership and retire chips.
 */

import { z } from 'zod';

const uuid = z.string().uuid();

export const LIFECYCLE_STATUSES = [
  'ENROLLED', 'CLAIMED', 'ASSOCIATED', 'ACTIVE', 'RELEASED', 'TRANSFERRED', 'RETIRED', 'SUSPENDED',
] as const;

/**
 * Every admin action needs a typed reason. It is stored in the append-only
 * audit row, never in logs. The DB functions enforce the same minimum.
 */
export const REASON_MIN = 10;
const reason = z.string().trim().min(REASON_MIN, `Reason must be at least ${REASON_MIN} characters`).max(500);

/** Admin screens identify a chip by the END of its UID (never the full UID in lists). */
export const UID_SUFFIX_LENGTH = 6;
export const uidSuffix = (tagUid: string): string => tagUid.slice(-UID_SUFFIX_LENGTH).toUpperCase();

/** GET /admin/tags query string. Every filter optional. */
export const listTagsQuerySchema = z.object({
  status: z.enum(LIFECYCLE_STATUSES).optional(),
  uidSuffix: z.string().regex(/^[0-9a-fA-F]{2,14}$/, 'uidSuffix must be 2-14 hex characters').optional(),
  itemId: uuid.optional(),
  creatorId: uuid.optional(),
  keyVersion: z.coerce.number().int().min(1).max(255).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const tagIdParamSchema = uuid;

export const suspensionBodySchema = z.object({ reason }).strict();

export const resetBodySchema = z.object({
  newTagId: uuid,
  reason,
  /** The admin types the last 6 hex chars of the OLD chip's UID to confirm. */
  confirmUidSuffix: z.string().trim().length(UID_SUFFIX_LENGTH),
}).strict();
