/**
 * Structured security events — S-NFC3 Addendum (Security Event Logging).
 *
 * Emission only. No DB writes, no migration, no alerting: the log drain,
 * CloudWatch metric filters, detection rules and AI triage agents all land in
 * S-SEC0 (Blue Watchtower). This module exists so that the S-NFC3 lifecycle
 * code emits the right events *as it is written*, rather than being re-read and
 * retrofitted later.
 *
 * Contract:
 *   - One JSON line to stdout (App Runner -> CloudWatch).
 *   - Fire-and-forget: NEVER throws, never blocks, never changes a response.
 *   - Emitted AFTER the outcome is known, exactly once per decision point.
 *
 * HARD RULE — never log: raw chip UID, SUN URL, CMAC, PICC data, salt (raw or
 * decrypted), any key material, KMS plaintext, Receipt preimage, a full
 * Ownership ID in `ownership.lookup`, emails (HMAC them), names, request or
 * response bodies, user agents, query strings, or Stripe secrets.
 *
 * There are NO free-text fields anywhere in this schema. Every field is an
 * enum, a uuid, a number or a boolean. These logs are read by AI triage agents,
 * so any attacker-controlled string would be a prompt-injection vector. The Zod
 * schemas below are `.strict()` for exactly this reason: an unexpected key is a
 * validation failure, not a passthrough.
 */

import { createHmac } from 'crypto';
import { z } from 'zod';

export const SECURITY_EVENT_SCHEMA_VERSION = 'sec.v1' as const;

// ── Envelope ────────────────────────────────────────────────────────────────

const uuid = z.string().uuid();

/**
 * `result` is either `ok` or the API error code actually returned to the
 * caller. Constrained to a closed set — it must never carry a free-text
 * message.
 */
export const securityResultSchema = z.enum([
  'ok',
  'already_claimed',
  'token_released',
  'token_retired',
  'token_suspended',
  '2fa_required',
  'transfer_pending',
  'forbidden',
  'not_found',
  'invalid_argument',
  'sun_invalid',
  // S-NFC3.5: specific SDM failures surfaced to the caller (acceptance criteria).
  'replay_detected',
  'invalid_signature',
  'payment_required',
  'conflict',
  'internal',
  // S-NFC3-FE: a tap session that is unknown, expired, already used, bound to
  // another chip, or superseded by a newer tap. One code for all five on
  // purpose — telling a caller WHICH would help someone probing tokens.
  'tap_session_invalid',
]);

export type SecurityResult = z.infer<typeof securityResultSchema>;

const envelopeSchema = z.object({
  result: securityResultSchema,
  request_id: z.string().min(1),
  actor_id: uuid.nullable(),
  actor_type: z.enum(['user', 'staff', 'admin', 'anon', 'system']),
  ip: z.string().min(1),
  /** Express route PATTERN (`/api/v1/nfc/transfer/:id/complete`), never a raw URL. */
  route: z.string().min(1),
});

// ── Event catalog ───────────────────────────────────────────────────────────

const sunVerifySchema = envelopeSchema.extend({
  event: z.literal('nfc.sun_verify'),
  tag_id: uuid.nullable(),
  context: z.enum(['verify', 'claim', 'transfer_complete']),
  // S-NFC3.5 renames: cmac_invalid -> invalid_signature; counter_replay and
  // counter_regression -> replay_detected (regression is derivable from
  // counter < last_counter); UID mismatch now has its own code.
  sun_result: z.enum([
    'ok',
    'invalid_signature',
    'replay_detected',
    'uid_mismatch',
    'unknown_tag',
    'malformed',
  ]),
  counter: z.number().int().nullable(),
  last_counter: z.number().int().nullable(),
}).strict();

const enrollSchema = envelopeSchema.extend({
  event: z.literal('nfc.enroll'),
  tag_id: uuid.nullable(),
}).strict();

const claimSchema = envelopeSchema.extend({
  event: z.literal('nfc.claim'),
  tag_id: uuid.nullable(),
  prior_status: z.string().max(32).nullable(),
}).strict();

const transferSchema = envelopeSchema.extend({
  event: z.literal('nfc.transfer'),
  tag_id: uuid.nullable(),
  transfer_id: uuid.nullable(),
  action: z.enum(['initiate', 'complete_attempt', 'cancel']),
  transfer_type: z.enum(['sale', 'gift']).nullable(),
  /** Matches the live CHECK constraint `ownership_transfers_fee_payer_chk`. */
  fee_payer: z.enum(['BUYER', 'SELLER']).nullable(),
  payment_method: z.enum(['card', 'credit']).nullable(),
  /** HMAC only — never the address itself. Omitted when SECURITY_LOG_HMAC_KEY is unset. */
  to_email_hash: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional(),
}).strict();

const transferStateChangeSchema = envelopeSchema.extend({
  event: z.literal('transfer.state_change'),
  transfer_id: uuid,
  from: z.enum(['PENDING', 'COMPLETED', 'CANCELLED']).nullable(),
  to: z.enum(['PENDING', 'COMPLETED', 'CANCELLED']),
  /**
   * `to=COMPLETED` with `trigger !== 'webhook'` must be impossible. S-SEC0
   * treats any such line as Critical: it means a transfer completed without a
   * verified `payment_intent.succeeded`.
   */
  trigger: z.enum(['webhook', 'client', 'admin', 'system']),
}).strict();

const paymentWebhookSchema = envelopeSchema.extend({
  event: z.literal('payment.webhook'),
  stripe_event_type: z.string().max(64),
  signature_valid: z.boolean(),
  transfer_id: uuid.nullable(),
  /** S-ADMIN1 Ph2: set instead of transfer_id for a re-issue fee intent. */
  reissue_request_id: uuid.nullable().optional(),
  idempotent_replay: z.boolean(),
}).strict();

const releaseSchema = envelopeSchema.extend({
  event: z.literal('nfc.release'),
  tag_id: uuid.nullable(),
}).strict();

const replaceSchema = envelopeSchema.extend({
  event: z.literal('nfc.replace'),
  old_tag_id: uuid.nullable(),
  new_tag_id: uuid.nullable(),
}).strict();

/**
 * S-ADMIN1: an admin action on a token. The typed reason is NOT logged here
 * (free text); it lives in the append-only audit_logs row.
 */
const adminTagActionSchema = envelopeSchema.extend({
  event: z.literal('admin.tag_action'),
  action: z.enum(['suspend', 'unsuspend', 'reset']),
  tag_id: uuid.nullable(),
  new_tag_id: uuid.nullable(),
}).strict();

const reissueRequestSchema = envelopeSchema.extend({
  event: z.literal('nfc.reissue_request'),
  tag_id: uuid.nullable(),
  /** S-ADMIN1 Ph2: the owner-side step. Absent on the original S-NFC3 request event. */
  action: z.enum(['request', 'photo_url', 'pay', 'cancel']).optional(),
  reissue_request_id: uuid.nullable().optional(),
}).strict();

/**
 * S-ADMIN1 Ph2: an admin decision on a re-issue request. As with
 * admin.tag_action, the typed reason lives only in the audit row.
 */
const adminReissueActionSchema = envelopeSchema.extend({
  event: z.literal('admin.reissue_action'),
  action: z.enum(['approve', 'approve_waived', 'reject', 'fulfil']),
  reissue_request_id: uuid.nullable(),
  tag_id: uuid.nullable(),
  new_tag_id: uuid.nullable(),
}).strict();

const disclosureChangeSchema = envelopeSchema.extend({
  event: z.literal('nfc.disclosure_change'),
  tag_id: uuid.nullable(),
  /** Field NAMES only, from a closed set — never the values being disclosed. */
  fields_changed: z.array(
    z.enum(['origin_video', 'creator_name', 'claim_date', 'location']),
  ),
}).strict();

const authzDeniedSchema = envelopeSchema.extend({
  event: z.literal('authz.denied'),
  resource_type: z.enum(['tag', 'transfer', 'reissue']),
  resource_id: uuid.nullable(),
  reason: z.enum(['not_owner', 'previous_owner', 'not_recipient', 'role']),
}).strict();

const twoFactorGateSchema = envelopeSchema.extend({
  event: z.literal('auth.2fa_gate'),
  gate: z.enum(['claim', 'transfer_complete']),
  outcome: z.enum(['passed', 'missing', 'failed']),
}).strict();

const ownershipLookupSchema = envelopeSchema.extend({
  event: z.literal('ownership.lookup'),
  /** No owner or tag identity fields, and never the Ownership ID itself. */
  lookup_result: z.enum(['current', 'stale', 'not_found']),
}).strict();

const ownershipAuthAttemptSchema = envelopeSchema.extend({
  event: z.literal('ownership.auth_attempt'),
}).strict();

/**
 * S-NFC3-FE: a tap session was minted (`issue`) or redeemed (`consume`).
 * Never carries the token or its hash.
 */
const tapSessionSchema = envelopeSchema.extend({
  event: z.literal('nfc.tap_session'),
  action: z.enum(['issue', 'consume']),
  tag_id: uuid.nullable(),
  purpose: z.enum(['claim', 'transfer_complete', 'reissue_request']).nullable(),
}).strict();

/** S-NFC3-FE: an owner opened their Receipt (the private half of the proof). */
const ownershipReceiptSchema = envelopeSchema.extend({
  event: z.literal('ownership.receipt'),
  tag_id: uuid.nullable(),
}).strict();

const kmsOpSchema = envelopeSchema.extend({
  event: z.literal('kms.op'),
  operation: z.enum(['Encrypt', 'Decrypt', 'GenerateDataKey', 'GenerateMac']),
  purpose: z.enum(['ownership_salt', 'tag_key']),
  tag_id: uuid.nullable(),
}).strict();

export const securityEventSchema = z.discriminatedUnion('event', [
  sunVerifySchema,
  enrollSchema,
  claimSchema,
  transferSchema,
  transferStateChangeSchema,
  paymentWebhookSchema,
  releaseSchema,
  replaceSchema,
  reissueRequestSchema,
  adminTagActionSchema,
  adminReissueActionSchema,
  disclosureChangeSchema,
  authzDeniedSchema,
  twoFactorGateSchema,
  ownershipLookupSchema,
  ownershipAuthAttemptSchema,
  kmsOpSchema,
  tapSessionSchema,
  ownershipReceiptSchema,
]);

export type SecurityEvent = z.infer<typeof securityEventSchema>;
export type SecurityEventName = SecurityEvent['event'];

// ── Emission ────────────────────────────────────────────────────────────────

/**
 * Emits one validated security event as a single JSON line on stdout.
 *
 * Never throws. A payload that fails validation produces a single
 * `security.event_invalid` line carrying the event NAME only — never the
 * offending payload, which by definition did not pass redaction checks.
 */
export const emitSecurityEvent = (event: SecurityEvent): void => {
  try {
    const parsed = securityEventSchema.safeParse(event);

    if (!parsed.success) {
      console.log(JSON.stringify({
        schema: SECURITY_EVENT_SCHEMA_VERSION,
        event: 'security.event_invalid',
        attempted_event:
          typeof (event as { event?: unknown })?.event === 'string'
            ? (event as { event: string }).event
            : 'unknown',
        ts: new Date().toISOString(),
      }));
      return;
    }

    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      schema: SECURITY_EVENT_SCHEMA_VERSION,
      ...parsed.data,
    }));
  } catch {
    // Fire-and-forget: a logging failure must never surface to the caller.
  }
};

/**
 * HMAC-SHA256 of a lowercased email, for `nfc.transfer.to_email_hash`.
 *
 * Returns null when `SECURITY_LOG_HMAC_KEY` is unset — the addendum specifies
 * omitting the field rather than failing, so a missing key degrades the signal
 * without breaking a transfer. Key lives at
 * `op://AM_Development/Security/log-hmac-key`.
 */
export const hashEmailForLog = (email: string | null | undefined): string | null => {
  const key = process.env.SECURITY_LOG_HMAC_KEY;
  if (!key || !email) return null;

  try {
    return createHmac('sha256', key).update(email.trim().toLowerCase()).digest('hex');
  } catch {
    return null;
  }
};
