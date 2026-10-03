/**
 * User-facing copy for token states and errors (Brand Voice Guide: warm
 * authority, short sentences, no em dashes, no hype).
 */

import type { TokenErrorReason } from '../api/tokenApi';

export type StatusTone = 'good' | 'neutral' | 'warning' | 'bad';

export interface StatusCopy {
  readonly label: string;
  readonly detail: string;
  readonly tone: StatusTone;
}

export const statusCopy = (status: string | null | undefined): StatusCopy => {
  switch (status) {
    case 'ACTIVE':
      return { label: 'Active', detail: 'This token is genuine and has an owner on record.', tone: 'good' };
    case 'ENROLLED':
      return { label: 'Unclaimed', detail: 'This token is genuine and has not been claimed yet.', tone: 'neutral' };
    case 'SUSPENDED':
      return { label: 'On hold', detail: 'This token is on hold while we review it. Do not buy it until the hold clears.', tone: 'warning' };
    case 'RELEASED':
      return { label: 'Released', detail: 'The owner released this token. It is no longer valid.', tone: 'bad' };
    case 'RETIRED':
      return { label: 'Retired', detail: 'This chip has been retired and replaced. It is no longer valid.', tone: 'bad' };
    default:
      return { label: 'Unknown', detail: 'We could not determine the state of this token.', tone: 'warning' };
  }
};

/** Copy for a tap that did not verify. */
export const tapFailureCopy = (reason: string): { title: string; body: string } => {
  switch (reason) {
    case 'replay_detected':
      return {
        title: 'This tap was already used.',
        body: 'Each tap works once. Tap the token again with your phone to get a fresh check.',
      };
    case 'invalid_signature':
      return {
        title: 'We could not verify this token.',
        body: 'The tap did not match a genuine Authentic Materials chip. Tap again. If it still fails, do not buy the item.',
      };
    default:
      return {
        title: 'We could not verify this token.',
        body: 'Tap the token again with your phone. If it still fails, do not buy the item.',
      };
  }
};

/** Copy for a claim the server refused. */
export const claimErrorCopy = (reason: TokenErrorReason | null, fallback: string): string => {
  switch (reason) {
    case 'tap_session_invalid':
      return 'Your tap has expired or was already used. Tap the token again, then claim.';
    case 'already_claimed':
      return 'Someone has already claimed this token.';
    case 'token_released':
      return 'This token was released and can no longer be claimed.';
    case 'token_retired':
      return 'This chip was retired and can no longer be claimed.';
    case 'token_suspended':
      return 'This token is on hold and cannot be claimed right now.';
    case '2fa_required':
      return 'Claiming needs two-factor authentication on your account. It is not available yet. We will let you know when it is.';
    default:
      return fallback;
  }
};

export const BUYER_WARNING =
  'Buying this item? Do not pay until the owner starts a transfer to you. A transfer is the only way ownership moves.';
