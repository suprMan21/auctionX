import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import {
  emitSecurityEvent,
  hashEmailForLog,
  securityEventSchema,
  SECURITY_EVENT_SCHEMA_VERSION,
  type SecurityEvent,
  type SecurityEventName,
} from '../lib/security/securityEvent';

/**
 * S-NFC3 Addendum — Security Event Logging.
 *
 * Acceptance criteria covered here:
 *   - emitSecurityEvent exists, Zod-validated, never throws (invalid payload)
 *   - every row in the event catalog has a spec asserting it emits
 *   - redaction: no UID, SUN URL, email, salt, or free-text string escapes
 */

const envelope = {
  result: 'ok',
  request_id: 'req-1',
  actor_id: '11111111-1111-4111-8111-111111111111',
  actor_type: 'user',
  ip: '203.0.113.9',
  route: '/api/v1/nfc/claim',
} as const;

const TAG_ID = '22222222-2222-4222-8222-222222222222';
const TRANSFER_ID = '33333333-3333-4333-8333-333333333333';

/** One valid instance of every event in the catalog. */
const CATALOG: ReadonlyArray<SecurityEvent> = [
  { ...envelope, event: 'nfc.sun_verify', tag_id: TAG_ID, context: 'claim', sun_result: 'ok', counter: 5, last_counter: 4 },
  { ...envelope, event: 'nfc.enroll', tag_id: TAG_ID },
  { ...envelope, event: 'nfc.claim', tag_id: TAG_ID, prior_status: 'ENROLLED' },
  { ...envelope, event: 'nfc.transfer', tag_id: TAG_ID, transfer_id: TRANSFER_ID, action: 'initiate', transfer_type: 'sale', fee_payer: 'BUYER', payment_method: 'card', to_email_hash: null },
  { ...envelope, event: 'transfer.state_change', transfer_id: TRANSFER_ID, from: 'PENDING', to: 'COMPLETED', trigger: 'webhook' },
  { ...envelope, event: 'payment.webhook', stripe_event_type: 'payment_intent.succeeded', signature_valid: true, transfer_id: TRANSFER_ID, idempotent_replay: false },
  { ...envelope, event: 'nfc.release', tag_id: TAG_ID },
  { ...envelope, event: 'nfc.replace', old_tag_id: TAG_ID, new_tag_id: TRANSFER_ID },
  { ...envelope, event: 'nfc.reissue_request', tag_id: TAG_ID },
  { ...envelope, event: 'nfc.disclosure_change', tag_id: TAG_ID, fields_changed: ['origin_video'] },
  { ...envelope, event: 'authz.denied', resource_type: 'tag', resource_id: TAG_ID, reason: 'not_owner' },
  { ...envelope, event: 'auth.2fa_gate', gate: 'claim', outcome: 'passed' },
  { ...envelope, event: 'ownership.lookup', lookup_result: 'current' },
  { ...envelope, event: 'ownership.auth_attempt' },
  { ...envelope, event: 'kms.op', operation: 'Encrypt', purpose: 'ownership_salt', tag_id: TAG_ID },
];

/** Every event name the union declares — the catalog must cover all of them. */
const ALL_EVENT_NAMES: ReadonlyArray<SecurityEventName> = [
  'nfc.sun_verify', 'nfc.enroll', 'nfc.claim', 'nfc.transfer',
  'transfer.state_change', 'payment.webhook', 'nfc.release', 'nfc.replace',
  'nfc.reissue_request', 'nfc.disclosure_change', 'authz.denied',
  'auth.2fa_gate', 'ownership.lookup', 'ownership.auth_attempt', 'kms.op',
];

describe('emitSecurityEvent', () => {
  let logSpy: MockInstance<(...args: unknown[]) => void>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {}) as unknown as MockInstance<(...args: unknown[]) => void>;
  });

  afterEach(() => {
    logSpy.mockRestore();
    delete process.env.SECURITY_LOG_HMAC_KEY;
  });

  const emitted = (): Record<string, unknown>[] =>
    logSpy.mock.calls.map((args: unknown[]) => JSON.parse(String(args[0])) as Record<string, unknown>);

  it('covers every event in the catalog', () => {
    expect(new Set(CATALOG.map((e) => e.event))).toEqual(new Set(ALL_EVENT_NAMES));
  });

  it.each(CATALOG.map((e) => [e.event, e] as const))(
    'emits %s as one valid JSON line',
    (name, event) => {
      emitSecurityEvent(event);

      expect(logSpy).toHaveBeenCalledTimes(1);
      const line = emitted()[0];
      expect(line.event).toBe(name);
      expect(line.schema).toBe(SECURITY_EVENT_SCHEMA_VERSION);
      expect(typeof line.ts).toBe('string');
      expect(securityEventSchema.safeParse(event).success).toBe(true);
    },
  );

  it('never throws on an invalid payload, and logs only the event name', () => {
    const bad = {
      event: 'nfc.claim',
      tag_id: 'not-a-uuid',
      secret: 'super-secret-value',
    } as unknown as SecurityEvent;

    expect(() => emitSecurityEvent(bad)).not.toThrow();

    const line = emitted()[0];
    expect(line.event).toBe('security.event_invalid');
    expect(line.attempted_event).toBe('nfc.claim');
    // The offending payload never reaches the log.
    expect(JSON.stringify(line)).not.toContain('super-secret-value');
  });

  it('never throws on a completely malformed input', () => {
    expect(() => emitSecurityEvent(null as unknown as SecurityEvent)).not.toThrow();
    expect(() => emitSecurityEvent(undefined as unknown as SecurityEvent)).not.toThrow();
    expect(() => emitSecurityEvent('nope' as unknown as SecurityEvent)).not.toThrow();
  });

  it('rejects an unknown extra field rather than passing it through', () => {
    // .strict() — an added key is a validation failure, so a future careless
    // `...tag` spread cannot smuggle aes_key_enc into a log line.
    const sneaky = {
      ...envelope,
      event: 'nfc.claim',
      tag_id: TAG_ID,
      prior_status: 'ENROLLED',
      aes_key_enc: 'deadbeefdeadbeefdeadbeefdeadbeef',
    } as unknown as SecurityEvent;

    emitSecurityEvent(sneaky);

    const line = emitted()[0];
    expect(line.event).toBe('security.event_invalid');
    expect(JSON.stringify(line)).not.toContain('deadbeef');
  });

  describe('redaction sweep', () => {
    // Values that must never appear in any emitted line.
    const CHIP_UID = '04A27E02936980';
    const SUN_URL = 'https://am.example/t?picc_data=AABBCCDDEEFF00112233445566778899&cmac=0011223344556677';
    const EMAIL = 'collector@example.com';
    const SALT = 'f'.repeat(64);

    it('emits no forbidden value across the full catalog', () => {
      for (const event of CATALOG) emitSecurityEvent(event);

      const blob = JSON.stringify(emitted());
      for (const forbidden of [CHIP_UID, SUN_URL, EMAIL, SALT]) {
        expect(blob).not.toContain(forbidden);
      }
    });

    it('drops an event that tries to carry a UID or SUN URL', () => {
      for (const extra of [{ tag_uid: CHIP_UID }, { sun_url: SUN_URL }, { salt: SALT }]) {
        logSpy.mockClear();
        emitSecurityEvent({
          ...envelope, event: 'nfc.claim', tag_id: TAG_ID, prior_status: 'ENROLLED',
          ...extra,
        } as unknown as SecurityEvent);

        expect(emitted()[0].event).toBe('security.event_invalid');
      }
    });

    it('carries no free-text string field outside the allowed set', () => {
      for (const event of CATALOG) emitSecurityEvent(event);

      // Keys permitted to hold a free-form-ish string. Everything else must be
      // an enum, uuid, number or boolean.
      const allowedStringKeys = new Set([
        'ts', 'schema', 'event', 'result', 'request_id', 'actor_id', 'actor_type',
        'ip', 'route', 'context', 'sun_result', 'prior_status', 'action',
        'transfer_type', 'fee_payer', 'payment_method', 'to_email_hash',
        'transfer_id', 'tag_id', 'old_tag_id', 'new_tag_id', 'from', 'to',
        'trigger', 'stripe_event_type', 'resource_type', 'resource_id', 'reason',
        'gate', 'outcome', 'lookup_result', 'operation', 'purpose',
      ]);

      for (const line of emitted()) {
        for (const [key, value] of Object.entries(line)) {
          if (typeof value === 'string') {
            expect(allowedStringKeys.has(key)).toBe(true);
          }
        }
      }
    });
  });
});

describe('hashEmailForLog', () => {
  afterEach(() => {
    delete process.env.SECURITY_LOG_HMAC_KEY;
  });

  it('returns null when SECURITY_LOG_HMAC_KEY is unset, rather than failing', () => {
    // The addendum: "If unset, omit to_email_hash rather than fail." A missing
    // key degrades the signal; it must never break a transfer.
    expect(hashEmailForLog('collector@example.com')).toBeNull();
  });

  it('produces a stable, case-insensitive HMAC that is not the address', () => {
    process.env.SECURITY_LOG_HMAC_KEY = 'a'.repeat(44);

    const a = hashEmailForLog('Collector@Example.com');
    const b = hashEmailForLog('  collector@example.com  ');

    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toContain('collector');
  });

  it('distinguishes different addresses', () => {
    process.env.SECURITY_LOG_HMAC_KEY = 'a'.repeat(44);
    expect(hashEmailForLog('one@example.com')).not.toBe(hashEmailForLog('two@example.com'));
  });

  it('returns null for a null address', () => {
    process.env.SECURITY_LOG_HMAC_KEY = 'a'.repeat(44);
    expect(hashEmailForLog(null)).toBeNull();
  });
});
