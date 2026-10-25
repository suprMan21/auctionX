/**
 * S-ADMIN1 Ph3a — stuck-payment request shapes.
 *
 * Who may act (Locked 2026-10-03: support Re-applies, admin+ refunds) is the
 * reapply_payments / refund_token_fees permissions since S-ADMIN2 Ph1; see
 * lib/admin/permissions.ts. The database functions re-check them.
 */

import { z } from 'zod';
import { REASON_MIN } from '../../services/nfc/adminTagSchemas';

// ── Request validation ──────────────────────────────────────────────────────

const reason = z.string().trim().min(REASON_MIN, `Reason must be at least ${REASON_MIN} characters`).max(500);

export const INCIDENT_FILTERS = ['OPEN', 'RESOLVED', 'REFUNDED', 'ALL'] as const;

export const listIncidentsQuerySchema = z.object({
  status: z.enum(INCIDENT_FILTERS).default('OPEN'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(25),
}).strict();

export const incidentIdParamSchema = z.string().uuid();

export const reapplyBodySchema = z.object({ reason }).strict();

/** What an admin types to confirm a refund: the end of the PaymentIntent id. */
export const INTENT_SUFFIX_LENGTH = 6;
export const intentSuffix = (intentId: string): string => intentId.slice(-INTENT_SUFFIX_LENGTH);

export const refundBodySchema = z.object({
  reason,
  confirmSuffix: z.string().trim().length(INTENT_SUFFIX_LENGTH, `Type the last ${INTENT_SUFFIX_LENGTH} characters of the payment id`),
}).strict();
