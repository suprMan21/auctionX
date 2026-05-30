import crypto from 'node:crypto';
import * as yotiSdk from 'yoti';
import { AppError } from '../errors';
import type { YotiClient } from './YotiClient';
import type {
  CreateSessionInput,
  CreateSessionResult,
  VerifiedWebhook,
  YotiNotificationPayload,
  YotiOutcome,
  YotiSessionDetail,
  YotiSessionStatus,
} from './types';

/**
 * LiveYotiClient — real Yoti hosted-IDV implementation.
 *
 * Env vars (resolved from `op://AM_Development/Yoti*` at process startup via
 * the cc-auctionx-op launcher — see backend/.env.op):
 *   - YOTI_SDK_ID         (createSession + getSession)
 *   - YOTI_PEM_KEY        (createSession + getSession)
 *   - YOTI_WEBHOOK_SECRET (verifyWebhookSignature)
 *   - YOTI_BASE_URL       (used to assemble the user-facing iframe URL)
 *
 * Env vars are read at method-call time (not in the constructor) so that
 * vitest can construct `new LiveYotiClient()` without populating every var.
 *
 * Sandbox-vs-prod: staging points YOTI_SDK_ID + YOTI_PEM_KEY at the sandbox
 * 1Password items (`Yoti_stagingSandbox` + `yoti_stagingSDKKey`). The prod
 * App Runner service flips the same env vars to production secrets at the
 * prod-push session — no code change needed.
 */
// Narrow type aliases for the bits of the Yoti SDK we touch — the package
// doesn't ship its own .d.ts, and skipLibCheck means `import * as yotiSdk`
// resolves to `any` at the type level. The aliases let TS check call shapes
// inside this file without us owning the SDK's full surface.
type YotiSdkSession = { getSessionId(): string; getClientSessionToken(): string };
type YotiSdkGetResult = {
  getSessionId(): string;
  getState(): string;
  getChecks?: () => unknown[];
};
type YotiIDVClient = {
  createSession(spec: unknown): Promise<YotiSdkSession>;
  getSession(sessionId: string): Promise<YotiSdkGetResult>;
};
type LivenessBuilder = { forStaticLiveness(): LivenessBuilder; build(): unknown };

const sdk = yotiSdk as unknown as {
  IDVClient: new (sdkId: string, pem: string | Buffer) => YotiIDVClient;
  SessionSpecificationBuilder: new () => {
    withClientSessionTokenTtl(s: number): ReturnType<typeof Function>;
    withResourcesTtl(s: number): unknown;
    withUserTrackingId(id: string): unknown;
    withRequestedCheck(c: unknown): unknown;
    withSdkConfig(c: unknown): unknown;
    withRequiredDocument(d: unknown): unknown;
    withNotifications(n: unknown): unknown;
    build(): unknown;
  };
  SdkConfigBuilder: new () => {
    withAllowsCameraAndUpload(): unknown;
    withSuccessUrl(u: string): unknown;
    withErrorUrl(u: string): unknown;
    build(): unknown;
  };
  RequiredIdDocumentBuilder: new () => { build(): unknown };
  RequestedDocumentAuthenticityCheckBuilder: new () => {
    withManualCheckFallback(): unknown;
    withManualCheckAlways(): unknown;
    withManualCheckNever(): unknown;
    build(): unknown;
  };
  RequestedFaceMatchCheckBuilder: new () => {
    withManualCheckFallback(): unknown;
    withManualCheckAlways(): unknown;
    withManualCheckNever(): unknown;
    build(): unknown;
  };
  RequestedLivenessCheckBuilder: new () => LivenessBuilder;
  NotificationConfigBuilder: new () => {
    withEndpoint(u: string): unknown;
    withAuthTypeBearer(): unknown;
    withAuthToken(t: string): unknown;
    forSessionCompletion(): unknown;
    build(): unknown;
  };
};

// Minimal type for the Yoti GetSessionResult check entries — only the surface
// we touch to derive outcome + rejection_reason.
type YotiCheck = {
  getType?: () => string;
  getReport?: () => {
    recommendation?: { value?: string; reason?: string } | null;
  } | null;
};

const requireEnv = (name: string): string => {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new AppError('internal', `LiveYotiClient: ${name} is not set`);
  }
  return v;
};

// AWS App Runner env-var values must match the regex `.*` — single-line only.
// PEM blocks are inherently multi-line, so we store the PEM with literal `\n`
// escape sequences in env (one line) and decode here. Same pattern as Firebase
// service-account keys, JWT signing keys, etc. Passthrough for already-decoded
// PEMs (local dev via 1Password injection preserves real newlines).
const decodePem = (raw: string): string =>
  raw.includes('\\n') && !raw.includes('\n') ? raw.replace(/\\n/g, '\n') : raw;

const mapState = (raw: string): YotiSessionStatus => {
  switch (raw.toUpperCase()) {
    case 'COMPLETED':
      return 'completed';
    case 'EXPIRED':
      return 'expired';
    case 'FAILED':
      return 'failed';
    case 'CREATED':
      return 'created';
    default:
      // ONGOING + anything unknown → in_progress. The webhook flow drives the
      // authoritative DB transitions; getSession is a status read only.
      return 'in_progress';
  }
};

export class LiveYotiClient implements YotiClient {
  async createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
    const sdkId = requireEnv('YOTI_SDK_ID');
    const pemKey = decodePem(requireEnv('YOTI_PEM_KEY'));
    const baseUrl = requireEnv('YOTI_BASE_URL').replace(/\/+$/, '');
    const webhookUrl = requireEnv('YOTI_WEBHOOK_URL');
    const webhookSecret = requireEnv('YOTI_WEBHOOK_SECRET');

    const client = new sdk.IDVClient(sdkId, pemKey);

    const notifications = (new sdk.NotificationConfigBuilder()
      .withEndpoint(webhookUrl) as any)
      .withAuthTypeBearer()
      .withAuthToken(webhookSecret)
      .forSessionCompletion()
      .build();

    // Each check requires a manualCheck mode (Yoti SDK validates this server-
    // side and rejects with "manualCheck cannot be null or empty" otherwise).
    // `withManualCheckFallback()` opts into Yoti's hybrid automation: try the
    // automated check first; only fall back to a human reviewer if it fails.
    const spec = (new sdk.SessionSpecificationBuilder()
      .withClientSessionTokenTtl(600) as any)
      .withResourcesTtl(87000)
      .withUserTrackingId(input.userId)
      .withRequestedCheck(
        (new sdk.RequestedDocumentAuthenticityCheckBuilder() as any).withManualCheckFallback().build(),
      )
      .withRequestedCheck(
        (new sdk.RequestedFaceMatchCheckBuilder() as any).withManualCheckFallback().build(),
      )
      .withRequestedCheck(new sdk.RequestedLivenessCheckBuilder().forStaticLiveness().build())
      .withSdkConfig(
        (new sdk.SdkConfigBuilder().withAllowsCameraAndUpload() as any)
          .withSuccessUrl(input.returnUrl)
          .withErrorUrl(input.returnUrl)
          .build(),
      )
      .withRequiredDocument(new sdk.RequiredIdDocumentBuilder().build())
      .withNotifications(notifications)
      .build();

    const session = await client.createSession(spec);
    const sessionId = session.getSessionId();
    const token = session.getClientSessionToken();

    return {
      sessionId,
      sessionUrl: `${baseUrl}/web/index.html?sessionID=${encodeURIComponent(sessionId)}&sessionToken=${encodeURIComponent(token)}`,
    };
  }

  async getSession(sessionId: string): Promise<YotiSessionDetail> {
    const sdkId = requireEnv('YOTI_SDK_ID');
    const pemKey = decodePem(requireEnv('YOTI_PEM_KEY'));

    const client = new sdk.IDVClient(sdkId, pemKey);
    const result = await client.getSession(sessionId);
    const status = mapState(result.getState());

    // Derive outcome + rejectionReason from the checks array. Only meaningful
    // when the session has reached `completed`; otherwise return nulls and the
    // webhook handler treats this as in-flight.
    let outcome: YotiOutcome | null = null;
    let rejectionReason: string | null = null;
    if (status === 'completed') {
      const checks: YotiCheck[] = (result.getChecks?.() ?? []) as YotiCheck[];
      // Only derive outcome when checks are actually present — an empty checks
      // array means the SDK couldn't surface check details, and we'd rather
      // leave outcome=null (state machine treats that as completed_rejected
      // defensively) than wrongly mark a session VERIFIED.
      if (checks.length > 0) {
        let anyRejected = false;
        for (const check of checks) {
          const rec = check.getReport?.()?.recommendation;
          if (rec?.value && rec.value !== 'APPROVE') {
            anyRejected = true;
            rejectionReason = rejectionReason ?? rec.reason ?? `Check ${check.getType?.() ?? '?'} rejected`;
          }
        }
        outcome = anyRejected ? 'completed_rejected' : 'completed_verified';
      }
    }

    return {
      sessionId: result.getSessionId(),
      status,
      outcome,
      // Age estimation is best-effort from the Yoti SDK and varies by check
      // type; left null here and refined in a follow-up. The state machine
      // tolerates a null age_estimate (user.age_verified stays false).
      ageEstimate: null,
      rejectionReason,
    };
  }

  verifyWebhookAuth(rawBody: Buffer | string, authHeader: string | undefined): VerifiedWebhook {
    if (!authHeader) {
      throw new AppError('unauthenticated', 'Missing Authorization header');
    }
    const secret = process.env.YOTI_WEBHOOK_SECRET;
    if (!secret) {
      throw new Error(
        'LiveYotiClient.verifyWebhookAuth: YOTI_WEBHOOK_SECRET is not set. ' +
          'Populate op://AM_Development/Yoti/webhook-secret and re-run via cc-auctionx-op.',
      );
    }
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    const provided = Buffer.from(token, 'utf-8');
    const expected = Buffer.from(secret, 'utf-8');
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
}

/**
 * Test-only — no-op retained for compatibility with the original test scaffold
 * (S22 cached the SDK lazily; S22.5 went back to a top-level import because
 * vitest's strict mock objects to `mod.default ?? mod` fallbacks).
 */
export const __resetYotiSdkCache = (): void => {};
