import crypto from 'node:crypto';
import { AppError } from '../errors';
import { NotImplementedError } from './errors';
import type { YotiClient } from './YotiClient';
import type {
  CreateSessionInput,
  CreateSessionResult,
  VerifiedWebhook,
  YotiSessionDetail,
  YotiWebhookEnvelope,
} from './types';

/**
 * LiveYotiClient — real Yoti hosted-IDV implementation.
 *
 * Wired in two stages:
 *   - 2026-05-30 (this commit): webhook HMAC-SHA256 verification against
 *     YOTI_WEBHOOK_SECRET. Mirrors MockYotiClient's HMAC logic, just with the
 *     real secret. Safe to ship now because Boss has the sandbox SDK ID + PEM
 *     key in hand and the webhook secret pattern is universal (HMAC-SHA256 over
 *     raw body) — no Yoti API guesswork required.
 *   - S22.5 (deferred): drops the two remaining `NotImplementedError` throws on
 *     createSession + getSession. Those depend on Yoti's IDV REST API / SDK
 *     surface (which varies by SDK version) and shouldn't be guessed — S22.5
 *     reads current Yoti docs against an installed `@getyoti/sdk-node` version
 *     and wires them.
 *
 * Env vars (resolved from `op://AM_Development/Yoti/*` at process startup by
 * the cc-auctionx-op launcher — see backend/.env.op):
 *   - YOTI_SDK_ID         (createSession + getSession, S22.5)
 *   - YOTI_PEM_KEY        (createSession + getSession, S22.5)
 *   - YOTI_WEBHOOK_SECRET (verifyWebhookSignature, this commit)
 *   - YOTI_BASE_URL       (createSession + getSession, S22.5)
 *   - YOTI_RETURN_URL     (createSession, S22.5)
 *
 * Env vars are read at method-call time (not in constructor) so that a vitest
 * that constructs `new LiveYotiClient()` to assert NotImplementedError doesn't
 * have to set every env var first.
 */
export class LiveYotiClient implements YotiClient {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createSession(_input: CreateSessionInput): Promise<CreateSessionResult> {
    // S22.5 — instantiate Yoti SDK client from YOTI_SDK_ID + YOTI_PEM_KEY, call
    // the hosted-IDV session-create endpoint with _input.purpose mapped to
    // Yoti's check spec + _input.returnUrl as the success redirect.
    throw new NotImplementedError('Yoti createSession wired in S22.5');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getSession(_sessionId: string): Promise<YotiSessionDetail> {
    // S22.5 — GET <YOTI_BASE_URL>/sessions/{sessionId} (or SDK equivalent) and
    // normalise the response into YotiSessionDetail.
    throw new NotImplementedError('Yoti getSession wired in S22.5');
  }

  verifyWebhookSignature(rawBody: Buffer | string, signature: string | undefined): VerifiedWebhook {
    if (!signature) {
      throw new AppError('unauthenticated', 'Missing webhook signature');
    }
    const secret = process.env.YOTI_WEBHOOK_SECRET;
    if (!secret) {
      // Misconfiguration — env not populated. Fail loudly; do NOT degrade to
      // accept the payload. Caller surfaces this as a 500.
      throw new Error(
        'LiveYotiClient.verifyWebhookSignature: YOTI_WEBHOOK_SECRET is not set. ' +
          'Populate op://AM_Development/Yoti/webhook-secret and re-run via cc-auctionx-op.',
      );
    }
    const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf-8');
    const expected = crypto.createHmac('sha256', secret).update(bodyBuffer).digest('hex');
    const sigBuf = Buffer.from(signature, 'utf-8');
    const expBuf = Buffer.from(expected, 'utf-8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      throw new AppError('unauthenticated', 'Invalid webhook signature');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyBuffer.toString('utf-8'));
    } catch {
      throw new AppError('invalid_argument', 'Webhook body is not valid JSON');
    }
    return { payload: parsed as YotiWebhookEnvelope };
  }
}
