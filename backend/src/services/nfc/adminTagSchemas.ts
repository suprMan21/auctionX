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

/**
 * What an admin types to confirm a destructive action on a chip: the last 6
 * characters of its serial (S-NFC-ID, v2 chips). Every chip in the current lot
 * shares the UID suffix …936980, so the UID suffix confirms nothing there. A v1
 * chip has no serial and falls back to its UID suffix.
 */
export const confirmationSuffix = (tag: { tag_uid: string; chip_serial: string | null }): string =>
  tag.chip_serial ? tag.chip_serial.slice(-UID_SUFFIX_LENGTH).toUpperCase() : uidSuffix(tag.tag_uid);

const confirmSuffix = z.string().trim().length(UID_SUFFIX_LENGTH);

export const resetBodySchema = z.object({
  newTagId: uuid,
  reason,
  /** confirmationSuffix() of the OLD chip. */
  confirmSuffix,
}).strict();

// ── S-ADMIN1 Ph2: re-issue queue ────────────────────────────────────────────

/**
 * Queue filter. READY = approved and paid (or waived), waiting for a chip.
 * DONE = fulfilled.
 */
export const REISSUE_QUEUE_FILTERS = [
  'PENDING', 'AWAITING_PAYMENT', 'READY', 'DONE', 'REJECTED', 'CANCELLED', 'ALL',
] as const;
export type ReissueQueueFilter = (typeof REISSUE_QUEUE_FILTERS)[number];

export const listReissueQuerySchema = z.object({
  status: z.enum(REISSUE_QUEUE_FILTERS).default('PENDING'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(25),
}).strict();

export const reissueIdParamSchema = uuid;

export const reissueApproveBodySchema = z.object({
  reason,
  /** Approve without charging (e.g. AM's fault). The reason is the waive reason. */
  waive: z.boolean().default(false),
}).strict();

export const reissueRejectBodySchema = z.object({ reason }).strict();

export const reissueFulfilBodySchema = z.object({
  newTagId: uuid,
  reason,
  /** confirmationSuffix() of the chip being retired. */
  confirmSuffix,
}).strict();
