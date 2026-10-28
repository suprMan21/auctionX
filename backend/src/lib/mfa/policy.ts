/**
 * S-2FA Ph4: who must use a second factor, and when (Decisions DB, Locked 2026-10-27).
 *
 *   atSignIn        no method yet → sent to setup right after the password:
 *                   staff (FEATURE_REQUIRE_ADMIN_2FA) and Creators (FEATURE_REQUIRE_CREATOR_2FA).
 *   forTokenActions claim, transfer, release, re-issue, disclosure refuse a session
 *                   without a second factor: everyone (FEATURE_REQUIRE_2FA), plus the above.
 *
 * Collectors are therefore only stopped at their first token action. Someone who
 * already has a method is asked for it at every sign-in (LoginPage), flag or not.
 * Database errors propagate: callers fail closed.
 */

import { isAdminTwoFactorRequired, isCreatorTwoFactorRequired, isTwoFactorRequired } from '../featureFlags';
import { getMfaStore } from './store';

export interface TwoFactorPolicy {
  atSignIn: boolean;
  forTokenActions: boolean;
}

export const twoFactorPolicy = async (userId: string): Promise<TwoFactorPolicy> => {
  const everyone = isTwoFactorRequired();
  const adminFlag = isAdminTwoFactorRequired();
  const creatorFlag = isCreatorTwoFactorRequired();
  if (!adminFlag && !creatorFlag) return { atSignIn: false, forTokenActions: everyone };
  const store = getMfaStore();
  const [role, type] = await Promise.all([
    adminFlag ? store.staffRole(userId) : Promise.resolve(null),
    creatorFlag ? store.accountType(userId) : Promise.resolve(null),
  ]);
  const atSignIn = role !== null || type === 'creator';
  return { atSignIn, forTokenActions: everyone || atSignIn };
};
