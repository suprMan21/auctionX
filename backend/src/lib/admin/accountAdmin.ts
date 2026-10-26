/**
 * S-ADMIN2 Ph1 — account administration request shapes.
 *
 * Suspend / Retire / Reactivate need manage_users; Delete, role changes and
 * the delete window need manage_admins (super_admin). The database functions
 * re-check every rule; these schemas only reject malformed requests early.
 */

import { z } from 'zod';
import { REASON_MIN } from '../../services/nfc/adminTagSchemas';
import { GRANTABLE_ROLES } from './permissions';

const reason = z.string().trim().min(REASON_MIN, `Reason must be at least ${REASON_MIN} characters`).max(500);

export const ACCOUNT_STATUS_FILTERS = ['all', 'active', 'suspended', 'retired', 'staff'] as const;

export const searchAccountsQuerySchema = z.object({
  q: z.string().trim().max(254).optional().default(''),
  status: z.enum(ACCOUNT_STATUS_FILTERS).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const accountIdParamSchema = z.string().uuid();

/** 1 hour to 1 year, matching the database function. */
export const SUSPEND_MAX_HOURS = 8760;

export const suspendBodySchema = z.object({
  hours: z.number().int().min(1).max(SUSPEND_MAX_HOURS),
  reason,
}).strict();

export const reasonBodySchema = z.object({ reason }).strict();

export const deleteBodySchema = z.object({
  /** The part of the account email before '@'. */
  confirm: z.string().trim().min(1).max(254),
  reason,
}).strict();

export const setRoleBodySchema = z.object({
  /** null revokes staff access. */
  role: z.enum(GRANTABLE_ROLES).nullable(),
  reason,
}).strict();

export const setDeleteWindowBodySchema = z.object({
  hours: z.number().int().min(1).max(8760),
  reason,
}).strict();

export const auditLogQuerySchema = z.object({
  admin: z.string().uuid().optional(),
  action: z.string().trim().min(1).max(64).optional(),
  entity: z.string().trim().min(1).max(64).optional(),
  /** Target: the audit row's entity_id (an account, tag, payment…). */
  target: z.string().uuid().optional(),
  /** Time range (ISO 8601 with offset): from is inclusive, to is exclusive. The
   *  console sends the admin's local day bounds (e.g. "Yesterday"). */
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict().refine((q) => !q.from || !q.to || Date.parse(q.from) < Date.parse(q.to), {
  message: 'from must be before to',
  path: ['to'],
});
