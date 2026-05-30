import crypto from 'node:crypto';
import { AppError } from '../errors';
import type { YotiClient } from './YotiClient';
import type {
  CreateSessionInput,
  CreateSessionResult,
  VerifiedWebhook,
  YotiNotificationPayload,
  YotiOutcome,
  YotiSessionDetail,
} from './types';

/**
 * Test token used as the Bearer secret for webhook payloads in mock mode.
 * Tests pass `Authorization: Bearer mock-yoti-webhook-secret-for-tests-only`
 * to exercise the verifyWebhookAuth happy path. Production never uses this —
 * LiveYotiClient reads YOTI_WEBHOOK_SECRET from 1Password.
 */
export const MOCK_WEBHOOK_SECRET = 'mock-yoti-webhook-secret-for-tests-only';

/**
 * Deterministic session id helper for unit tests. `mock_sess_<nanoid-like>`.
 * Not cryptographically random — the goal is human-readable test fixtures.
 */
const mockSessionId = (): string => `mock_sess_${crypto.randomBytes(8).toString('hex')}`;

/**
 * MockYotiClient — vitest + local dev implementation. Zero network calls.
 *
 * Behaviour:
 * - `createSession` always succeeds, returns a deterministic id + a fake URL.
 *   `input.mockOutcome` is stored on the in-memory map for `getSession` to read
 *   later, so a test can simulate "Yoti verified" vs "Yoti rejected" outcomes.
 * - `getSession` returns the last-known mock state for a session id.
 * - `verifyWebhookSignature` validates an HMAC-SHA256 over the raw body using
 *   MOCK_WEBHOOK_SECRET. Throws AppError('unauthenticated', ...) on mismatch —
 *   the route maps that to a 401 per the brief.
 */
export class MockYotiClient implements YotiClient {
  private readonly sessions = new Map<string, YotiSessionDetail>();

  async createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
    const sessionId = mockSessionId();
    const outcome: YotiOutcome | null = input.mockOutcome ?? null;
    this.sessions.set(sessionId, {
      sessionId,
      status: 'created',
      outcome,
      ageEstimate: null,
      rejectionReason: null,
    });
    return {
      sessionId,
      sessionUrl: `https://mock.yoti.test/sessions/${sessionId}?return=${encodeURIComponent(input.returnUrl)}`,
    };
  }

  async getSession(sessionId: string): Promise<YotiSessionDetail> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    return {
      sessionId,
      status: 'created',
      outcome: null,
      ageEstimate: null,
      rejectionReason: null,
    };
  }

  verifyWebhookAuth(rawBody: Buffer | string, authHeader: string | undefined): VerifiedWebhook {
    if (!authHeader) {
      throw new AppError('unauthenticated', 'Missing Authorization header');
    }
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    const provided = Buffer.from(token, 'utf-8');
    const expected = Buffer.from(MOCK_WEBHOOK_SECRET, 'utf-8');
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
      throw new AppError('unauthenticated', 'Invalid webhook token');
    }
    const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyBuffer.toString('utf-8'));
    } catch {
      throw new AppError('invalid_argument', 'Webhook body is not valid JSON');
    }
    return { payload: parsed as YotiNotificationPayload };
  }

  /** Test helper — let a spec drive the mocked session to a new state. */
  setSessionState(sessionId: string, patch: Partial<YotiSessionDetail>): void {
    const existing = this.sessions.get(sessionId) ?? {
      sessionId,
      status: 'created',
      outcome: null,
      ageEstimate: null,
      rejectionReason: null,
    };
    this.sessions.set(sessionId, { ...existing, ...patch });
  }

  /**
   * Test helper — produce the Authorization header that the mock webhook
   * verifier expects (`Bearer <MOCK_WEBHOOK_SECRET>`).
   */
  static authHeader(): string {
    return `Bearer ${MOCK_WEBHOOK_SECRET}`;
  }
}
