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
 *   2. YOTI_CLIENT_MODE === 'live' — LiveYotiClient (throws until S22.5).
 *   3. else — MockYotiClient.
 *
 * The client is memoised so the in-memory mock state survives across the
 * lifetime of one process (each test resets via `resetYotiClientForTests`).
 *
 * Note: per §5.5 of the brief, 1Password items for Yoti may not resolve at
 * runtime (yoti business-account verification still pending). When that
 * happens with mode=live, LiveYotiClient throws NotImplementedError — we
 * don't silently degrade to mock in production. Documented in
 * `docs/SESSION_22_VERIFICATION.md`.
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
  YotiOutcome,
  YotiSessionDetail,
  YotiSessionPurpose,
  YotiSessionStatus,
  YotiWebhookEnvelope,
} from './types';
export { YOTI_AGE_THRESHOLD } from './types';
export { MockYotiClient, MOCK_WEBHOOK_SECRET } from './MockYotiClient';
export { LiveYotiClient } from './LiveYotiClient';
export { NotImplementedError } from './errors';
export { isYotiFeatureEnabled } from './featureFlag';
