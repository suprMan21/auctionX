/**
 * S-ADMIN1 Ph3a — who may act on stuck payments.
 *
 * Locked 2026-10-03: support can Re-apply; refunds need admin or super_admin.
 * Keyed on the admin ROLE, not a permission: the seeded `support` role already
 * carries `process_refunds` from the parked marketplace, so that permission
 * cannot be the refund gate. The database functions re-check the same rule
 * (`payment_admin_actor_email`), so this middleware is the first gate, not the
 * only one.
 */

import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { REASON_MIN } from '../../services/nfc/adminTagSchemas';

export const PAYMENT_QUEUE_ROLES = ['support', 'admin', 'super_admin'] as const;
export const PAYMENT_REFUND_ROLES = ['admin', 'super_admin'] as const;

export const canRefundPayments = (role: string | undefined): boolean =>
  (PAYMENT_REFUND_ROLES as readonly string[]).includes(role ?? '');

export const requireAdminRole = (roles: readonly string[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
    if (!req.admin) {
      res.status(401).json({ success: false, data: null, error: 'Not authenticated' });
      return;
    }
    if (!roles.includes(req.admin.role)) {
      res.status(403).json({ success: false, data: null, error: 'Insufficient permissions' });
      return;
    }
    next();
  };

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
