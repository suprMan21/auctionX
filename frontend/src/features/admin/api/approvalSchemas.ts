/**
 * S-2FA Ph3a — two-admin approval. Response shapes for the approvals queue and
 * the 202 "sent for approval" answer from suspend / reset / retire.
 * Every response is validated: a shape the page does not expect is an error.
 */

import { z } from 'zod';

export const APPROVAL_ACTIONS = [
  'tag_reset', 'tag_suspend', 'account_suspend', 'account_retire',
  // S-2FA Ph3a2: re-issue fulfil (always) and lifting a hold someone else set.
  'reissue_fulfil', 'tag_unsuspend', 'account_unsuspend', 'account_reactivate',
] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'expired'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** List filters (GET /admin/approvals?status=). */
export const APPROVAL_FILTERS = ['waiting_for_me', 'open', 'closed', 'all'] as const;
export type ApprovalFilter = (typeof APPROVAL_FILTERS)[number];

const person = z.object({ id: z.string(), email: z.string().nullable() });
const chip = z.object({ chipName: z.string().nullable(), serialSuffix: z.string().nullable() });

/** The re-issue request behind a reissue_fulfil approval, so the approver can decide from the ticket. */
const reissueDetailsSchema = z.object({
  id: z.string(),
  status: z.string(),
  paymentStatus: z.string().nullable(),
  listAmountUsdCents: z.number().nullable(),
  chargedAmount: z.number().nullable(),
  chargedCurrency: z.string().nullable(),
  waiveReason: z.string().nullable(),
  reviewReason: z.string().nullable(),
  reviewedBy: person.nullable(),
  reviewedAt: z.string().nullable(),
  requestedAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  owner: person,
  photoCount: z.number().int().nonnegative(),
  /** 5-minute presigned URLs; may be empty when signing failed. */
  photoUrls: z.array(z.string()),
}).passthrough();
export type ApprovalReissueDetails = z.infer<typeof reissueDetailsSchema>;

/** Who placed the suspension / retirement an unsuspend or reactivate request lifts. */
const holdSchema = z.object({
  setBy: person.nullable(),
  setAt: z.string().nullable(),
  reason: z.string().nullable(),
}).passthrough();
export type ApprovalHold = z.infer<typeof holdSchema>;

export const approvalSchema = z.object({
  id: z.string(),
  action: z.enum(APPROVAL_ACTIONS),
  status: z.enum(APPROVAL_STATUSES),
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('token'), id: z.string(), chipName: z.string().nullable(), serialSuffix: z.string().nullable() }),
    z.object({ kind: z.literal('account'), id: z.string(), email: z.string().nullable() }),
    z.object({
      kind: z.literal('reissue'),
      /** The re-issue request id. */
      id: z.string(),
      tokenId: z.string(),
      chipName: z.string().nullable(),
      serialSuffix: z.string().nullable(),
    }),
  ]),
  details: z.object({
    newTagId: z.string().nullable().optional(),
    newChip: chip.nullable().optional(),
    hours: z.number().nullable().optional(),
    // A malformed block shows as "not available" rather than breaking the whole queue.
    reissue: reissueDetailsSchema.nullable().optional().catch(null),
    hold: holdSchema.nullable().optional().catch(null),
  }).passthrough(),
  reason: z.string(),
  requestedBy: person,
  requestedAt: z.string(),
  expiresAt: z.string(),
  decidedBy: person.nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  executedAt: z.string().nullable(),
  outcome: z.object({ ok: z.boolean(), message: z.string().nullable() }).nullable(),
  canApprove: z.boolean(),
  canCancel: z.boolean(),
});
export type Approval = z.infer<typeof approvalSchema>;

export const approvalListSchema = z.object({
  approvals: z.array(approvalSchema),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    pages: z.number().int(),
  }),
});
export type ApprovalList = z.infer<typeof approvalListSchema>;

export const approveResultSchema = z.object({
  approvalId: z.string(),
  status: z.literal('approved'),
  result: z.unknown(),
});

export const decisionResultSchema = z.record(z.unknown());

/** The 202 answer: nothing happened yet; another admin must approve it. */
export const approvalPendingSchema = z.object({
  approvalRequired: z.literal(true),
  approvalId: z.string(),
  expiresAt: z.string(),
});
export type ApprovalPending = z.infer<typeof approvalPendingSchema>;

/** The pending-approval payload of an action response, or null when the action ran. */
export const pendingApprovalOf = (body: unknown): ApprovalPending | null => {
  if (!body || typeof body !== 'object') return null;
  const data = 'data' in body ? (body as { data: unknown }).data : body;
  const parsed = approvalPendingSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
};

/** The approvals page link for one request. */
export const approvalLink = (id: string): string => `/admin/approvals?request=${encodeURIComponent(id)}`;
