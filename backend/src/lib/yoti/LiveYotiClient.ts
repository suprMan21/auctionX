import crypto from 'node:crypto';
import * as yotiSdk from 'yoti';
import { AppError } from '../errors';
import type { YotiClient } from './YotiClient';
import type {
  CreateSessionInput,
  CreateSessionResult,
  VerifiedWebhook,
  YotiSessionDetail,
  YotiSessionStatus,
  YotiWebhookEnvelope,
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
type YotiSdkGetResult = { getSessionId(): string; getState(): string };
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
    build(): unknown;
  };
  SdkConfigBuilder: new () => {
    withAllowsCameraAndUpload(): unknown;
    withSuccessUrl(u: string): unknown;
    withErrorUrl(u: string): unknown;
    build(): unknown;
  };
  RequiredIdDocumentBuilder: new () => { build(): unknown };
  RequestedDocumentAuthenticityCheckBuilder: new () => { build(): unknown };
  RequestedFaceMatchCheckBuilder: new () => { build(): unknown };
  RequestedLivenessCheckBuilder: new () => LivenessBuilder;
};

const requireEnv = (name: string): string => {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new AppError('internal', `LiveYotiClient: ${name} is not set`);
  }
  return v;
};

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
    const pemKey = requireEnv('YOTI_PEM_KEY');
    const baseUrl = requireEnv('YOTI_BASE_URL').replace(/\/+$/, '');

    const client = new sdk.IDVClient(sdkId, pemKey);

    const spec = (new sdk.SessionSpecificationBuilder()
      .withClientSessionTokenTtl(600) as any)
      .withResourcesTtl(87000)
      .withUserTrackingId(input.userId)
      .withRequestedCheck(new sdk.RequestedDocumentAuthenticityCheckBuilder().build())
      .withRequestedCheck(new sdk.RequestedFaceMatchCheckBuilder().build())
      .withRequestedCheck(new sdk.RequestedLivenessCheckBuilder().forStaticLiveness().build())
      .withSdkConfig(
        (new sdk.SdkConfigBuilder().withAllowsCameraAndUpload() as any)
          .withSuccessUrl(input.returnUrl)
          .withErrorUrl(input.returnUrl)
          .build(),
      )
      .withRequiredDocument(new sdk.RequiredIdDocumentBuilder().build())
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
    const pemKey = requireEnv('YOTI_PEM_KEY');

    const client = new sdk.IDVClient(sdkId, pemKey);
    const result = await client.getSession(sessionId);

    return {
      sessionId: result.getSessionId(),
      status: mapState(result.getState()),
      // outcome / ageEstimate / rejectionReason flow through the webhook path —
      // getSession is consulted only as a status read, never as the source of
      // truth for those fields.
      outcome: null,
      ageEstimate: null,
      rejectionReason: null,
    };
  }

  verifyWebhookSignature(rawBody: Buffer | string, signature: string | undefined): VerifiedWebhook {
    if (!signature) {
      throw new AppError('unauthenticated', 'Missing webhook signature');
    }
    const secret = process.env.YOTI_WEBHOOK_SECRET;
    if (!secret) {
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

/**
 * Test-only — no-op retained for compatibility with the original test scaffold
 * (S22 cached the SDK lazily; S22.5 went back to a top-level import because
 * vitest's strict mock objects to `mod.default ?? mod` fallbacks).
 */
export const __resetYotiSdkCache = (): void => {};
