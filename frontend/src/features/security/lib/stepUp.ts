/**
 * Which ways of confirming are offered for each action (Boss, 2026-10-27):
 *   - Changing sign-in methods: passkey, authenticator code or backup code
 *     (someone who lost their phone must still be able to fix their account).
 *   - Release and transfer complete: passkey or authenticator code. Staff
 *     accounts: passkey only.
 *   - Price changes and other admin actions: passkey only.
 * The server enforces the same rules; this only decides what the screen shows.
 */

import type { StepUpAction } from '../api/mfaApi';

export type StepUpMethod = 'passkey' | 'totp' | 'recovery_code';

const FACTOR_ACTIONS: readonly StepUpAction[] = ['factor_add', 'factor_remove', 'recovery_regen'];
const TOKEN_ACTIONS: readonly StepUpAction[] = ['release', 'transfer_complete'];

export const allowedStepUpMethods = (action: StepUpAction, isStaff: boolean): StepUpMethod[] => {
  if (FACTOR_ACTIONS.includes(action)) return ['passkey', 'totp', 'recovery_code'];
  if (TOKEN_ACTIONS.includes(action) && !isStaff) return ['passkey', 'totp'];
  return ['passkey'];
};

/** Refusal reasons that mean "confirm it's you, then try again". */
export const isStepUpRefusal = (err: unknown): boolean =>
  reasonOf(err) === 'step_up_required';

/** Refusal reasons that mean "this session has not passed its second factor yet". */
export const isSecondFactorRefusal = (err: unknown): boolean => {
  const r = reasonOf(err);
  return r === '2fa_required' || r === 'second_factor_required';
};

const reasonOf = (err: unknown): string | null => {
  if (!err || typeof err !== 'object') return null;
  const e = err as { reason?: unknown; code?: unknown };
  if (typeof e.reason === 'string') return e.reason;
  // adminApi keeps only `code`; the gate sets code = reason.
  return typeof e.code === 'string' ? e.code : null;
};

/** `/sign-in/verify?next=…` for the current page. */
export const secondFactorPathFor = (next: string): string =>
  `/sign-in/verify?next=${encodeURIComponent(next)}`;
