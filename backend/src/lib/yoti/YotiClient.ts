import type {
  CreateSessionInput,
  CreateSessionResult,
  VerifiedWebhook,
  YotiSessionDetail,
} from './types';

/**
 * YotiClient — vendor-agnostic surface the rest of the backend talks to.
 *
 * MockYotiClient implements the same contract for tests + dev (no network).
 * LiveYotiClient implements the same contract against the real Yoti hosted-IDV
 * API once S22.5 wires it up.
 *
 * `getYotiClient()` selects the implementation via `process.env.YOTI_CLIENT_MODE`
 * with default `'mock'`. Vitest always forces `'mock'`.
 */
export interface YotiClient {
  /**
   * Create a Yoti hosted-session for a user. The returned `sessionUrl` is the
   * Yoti-hosted page we redirect the user to. `sessionId` is what we persist
   * locally and what the webhook references.
   */
  createSession(input: CreateSessionInput): Promise<CreateSessionResult>;

  /**
   * Fetch the current detail of a Yoti session. Used by the status endpoint
   * and as a defence-in-depth check (we never trust webhook URL params).
   */
  getSession(sessionId: string): Promise<YotiSessionDetail>;

  /**
   * Verify the `Authorization: Bearer <token>` header on a Yoti IDV webhook
   * callback against the configured shared secret. MUST be called before
   * trusting any field on the payload. Throws on bad token.
   *
   * `rawBody` is the request body as a Buffer or string (Express `raw()` mounts
   * the route with `Content-Type: application/json`).
   *
   * `authHeader` is the full value of the `Authorization` request header
   * (`Bearer <token>`). The implementation strips the `Bearer ` prefix and
   * does a constant-time compare against the secret.
   */
  verifyWebhookAuth(rawBody: Buffer | string, authHeader: string | undefined): VerifiedWebhook;
}
