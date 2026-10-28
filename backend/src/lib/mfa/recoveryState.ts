/**
 * S-2FA Ph3b: read-only recovery state shared by the MFA service, the recovery
 * service and the route gates (kept apart so none of them import each other).
 */

import { AppError } from '../errors';
import { getMfaStore, type RecoveryRow } from './store';

/** End of the post-recovery freeze, or null when the account is not frozen. */
export const activeFreeze = async (userId: string, now = Date.now()): Promise<string | null> => {
  const r = await getMfaStore().latestRecovery(userId);
  return r?.status === 'completed' && r.freeze_ends_at && Date.parse(r.freeze_ends_at) > now ? r.freeze_ends_at : null;
};

export const FREEZE_MESSAGE =
  'Your account was recovered recently, so this is paused for a few days to keep your tokens safe.';

/**
 * Refuses while the account is in its post-recovery freeze (Boss 2026-10-27):
 * transfer start + accept, release, re-issue request, sign-in method changes,
 * backup codes, backup email, password / email change.
 */
export const assertNotFrozen = async (userId: string): Promise<void> => {
  if (await activeFreeze(userId)) {
    throw new AppError('failed_precondition', FREEZE_MESSAGE, { reason: 'recovery_freeze' });
  }
};

/**
 * The recovery whose finishing session this is, while it may still add its one
 * passkey or authenticator app. Null otherwise.
 */
export const recoveryEnrolment = async (
  userId: string, sessionId: string | null, now = Date.now(),
): Promise<RecoveryRow | null> => {
  if (!sessionId) return null;
  const r = await getMfaStore().latestRecovery(userId);
  if (!r || r.status !== 'completed' || r.finished_session_id !== sessionId || r.enrolled_at) return null;
  return r.enrol_until && Date.parse(r.enrol_until) > now ? r : null;
};
