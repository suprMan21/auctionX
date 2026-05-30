import { log } from '../logger';
import { MockYotiClient } from './MockYotiClient';
import { LiveYotiClient } from './LiveYotiClient';
import type { YotiClient } from './YotiClient';

let cachedClient: YotiClient | null = null;
let cachedMode: 'mock' | 'live' | null = null;

/**
 * Resolves the active YotiClient implementation.
 *
 * Selection rules (in order):
 *   1. NODE_ENV === 'test' — ALWAYS MockYotiClient (zero network in vitest).
 *   2. YOTI_CLIENT_MODE === 'live' — LiveYotiClient (real Yoti SDK, S22.5).
 *   3. else — MockYotiClient.
 *
 * The client is memoised so the in-memory mock state survives across the
 * lifetime of one process (each test resets via `resetYotiClientForTests`).
 *
 * Sandbox-in-staging pattern: with YOTI_CLIENT_MODE=live + sandbox SDK ID +
 * sandbox PEM in 1Password, this drives a real Yoti sandbox session. Prod
 * cutover only requires rotating env literals on the prod App Runner service.
 */
export const getYotiClient = (): YotiClient => {
  const desiredMode = resolveMode();
  if (cachedClient && cachedMode === desiredMode) return cachedClient;
  if (desiredMode === 'live') {
    log.info('yoti_client_select', { mode: 'live' });
    cachedClient = new LiveYotiClient();
  } else {
    log.info('yoti_client_select', { mode: 'mock' });
    cachedClient = new MockYotiClient();
  }
  cachedMode = desiredMode;
  return cachedClient;
};

const resolveMode = (): 'mock' | 'live' => {
  if (process.env.NODE_ENV === 'test') return 'mock';
  return process.env.YOTI_CLIENT_MODE === 'live' ? 'live' : 'mock';
};

/** Test-only — reset the cached client so a spec can swap mocks cleanly. */
export const resetYotiClientForTests = (): void => {
  cachedClient = null;
  cachedMode = null;
};

export type { YotiClient } from './YotiClient';
export type {
  CreateSessionInput,
  CreateSessionResult,
  VerifiedWebhook,
  YotiEventType,
  YotiNotificationPayload,
  YotiNotificationTopic,
  YotiOutcome,
  YotiSessionDetail,
  YotiSessionPurpose,
  YotiSessionStatus,
  YotiWebhookEnvelope,
} from './types';
export { YOTI_AGE_THRESHOLD } from './types';
export { MockYotiClient, MOCK_WEBHOOK_SECRET } from './MockYotiClient';
export { LiveYotiClient, __resetYotiSdkCache } from './LiveYotiClient';
export { isYotiFeatureEnabled } from './featureFlag';
