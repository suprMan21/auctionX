import type { YotiClient } from './YotiClient';
import { NotImplementedError } from './errors';
import type {
  CreateSessionInput,
  CreateSessionResult,
  VerifiedWebhook,
  YotiSessionDetail,
} from './types';

/**
 * LiveYotiClient — real Yoti hosted-IDV implementation. STUB until S22.5.
 *
 * Why this exists in S22: keeps the production deploy path safe. Even if
 * someone flips YOTI_CLIENT_MODE=live before Yoti business-account verification
 * clears + sandbox creds are populated, every method throws — the caller sees
 * an internal error and a load-bearing log line, not a silent Yoti session
 * leak or accidental API charge.
 *
 * S22.5 (mini-session, ~150 LoC) drops the throws and wires the real SDK:
 *   1. import { Client } from '@getyoti/sdk-node'
 *   2. construct Client from YOTI_SDK_ID + YOTI_PEM_KEY
 *   3. map createSession / getSession to the SDK calls
 *   4. implement verifyWebhookSignature against YOTI_WEBHOOK_SECRET (HMAC-SHA256
 *      over raw body, header name confirmed against current Yoti docs)
 */
export class LiveYotiClient implements YotiClient {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createSession(_input: CreateSessionInput): Promise<CreateSessionResult> {
    throw new NotImplementedError('Yoti live client wired in S22.5');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getSession(_sessionId: string): Promise<YotiSessionDetail> {
    throw new NotImplementedError('Yoti live client wired in S22.5');
  }

  verifyWebhookSignature(_rawBody: Buffer | string, _signature: string | undefined): VerifiedWebhook {
    throw new NotImplementedError('Yoti live client wired in S22.5');
  }
}
