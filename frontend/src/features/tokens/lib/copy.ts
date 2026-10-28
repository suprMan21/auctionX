/**
 * Collector-facing copy for seal states and errors (Brand Voice Guide: warm
 * authority, short sentences, no em dashes, no hype).
 *
 * S-SEAL1 Ph1 gate G1 (Locked 2026-10-28): collectors read "seal", never token
 * or chip. Staff screens keep Token / chip (features/admin/lib/labels.ts).
 * Only a tap verifies: never "check the code to verify".
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
      return { label: 'Active', detail: 'This seal is genuine and has an owner on record.', tone: 'good' };
    case 'ENROLLED':
      return { label: 'Unclaimed', detail: 'This seal is genuine and has not been claimed yet.', tone: 'neutral' };
    case 'SUSPENDED':
      return { label: 'On hold', detail: 'This seal is on hold while we review it. Do not buy the item until the hold clears.', tone: 'warning' };
    case 'RELEASED':
      return { label: 'Released', detail: 'The owner released this seal. It is no longer valid.', tone: 'bad' };
    case 'RETIRED':
      return { label: 'Retired', detail: 'This seal was retired and replaced. It is no longer valid.', tone: 'bad' };
    default:
      return { label: 'Unknown', detail: 'We could not determine the state of this seal.', tone: 'warning' };
  }
};

/** Copy for a tap that did not verify. */
export const tapFailureCopy = (reason: string): { title: string; body: string } => {
  switch (reason) {
    case 'replay_detected':
      return {
        title: 'This tap was already used.',
        body: 'Each tap works once. Tap the seal again with your phone to get a fresh check.',
      };
    case 'invalid_signature':
      return {
        title: 'We could not verify this seal.',
        body: 'The tap did not match a genuine Authentic Materials seal. Tap again. If it still fails, do not buy the item.',
      };
    default:
      return {
        title: 'We could not verify this seal.',
        body: 'Tap the seal again with your phone. If it still fails, do not buy the item.',
      };
  }
};

/** Copy for a claim the server refused. */
export const claimErrorCopy = (reason: TokenErrorReason | null, fallback: string): string => {
  switch (reason) {
    case 'tap_session_invalid':
      return 'Your tap has expired or was already used. Tap the seal again, then claim.';
    case 'already_claimed':
      return 'Someone has already claimed this seal.';
    case 'token_released':
      return 'This seal was released and can no longer be claimed.';
    case 'token_retired':
      return 'This seal was retired and can no longer be claimed.';
    case 'token_suspended':
      return 'This seal is on hold and cannot be claimed right now.';
    case '2fa_required':
      return 'Claiming needs two-step sign-in. Once it’s done, tap the seal again.';
    default:
      return fallback;
  }
};

/** Tap page (S-SEAL1 Ph1). The Verified state lasts this long after a tap the server accepted. */
export const TAP_COPY = {
  checking: 'Checking this seal…',
  noTapTitle: 'Tap the seal to check it.',
  noTapBody: 'Hold your phone near the Authentic Materials seal. Each tap opens a fresh, one-time check.',
  unknownTitle: 'This seal isn’t registered.',
  unknownBody: 'We have no record of this seal. Do not buy an item on the strength of it.',
  errorTitle: 'We could not check this seal.',
  notVerified: 'Not verified',
  genuine: 'Genuine seal',
  verifiedJustNow: 'Verified just now',
  checkedAgo: (seconds: number): string => `Checked by tap · ${seconds} s ago`,
  sealed: 'Sealed',
  owned: 'Owned',
  tapToCheck: 'Tap the seal to check',
  tapAgainToCheck: 'Tap the seal again to check',
  sealCodeLabel: 'Seal',
  youOwnThis: 'You own this.',
  claimedTitle: 'Claimed. It is yours.',
  claimedBody: 'Your Ownership ID is your public fingerprint for this seal.',
  viewInMyTokens: 'View it in My Tokens', // page name stays until the My Seals rename
  transferTitle: 'Is this seal being transferred to you?',
  looseTitle: 'Seal coming loose?',
  looseBody:
    'If the seal is lifting but still on the item, ask for a replacement now. We cannot replace a seal that has already come off.',
  looseLink: 'Request a replacement seal',
} as const;

export const BUYER_WARNING =
  'Buying this item? Do not pay until the owner starts a transfer to you. A transfer is the only way ownership moves.';

/** Copy for a refused transfer action (initiate, accept, cancel). */
export const transferErrorCopy = (error: { reason: TokenErrorReason | null; code: string | null; message: string }): string => {
  switch (error.reason) {
    case 'tap_session_invalid':
      return 'Your tap has expired or was already used. Tap the seal again to accept.';
    case 'transfer_pending':
      return 'A transfer of this seal is already in progress.';
    case 'token_released':
      return 'This seal was released and can no longer be transferred.';
    case 'token_retired':
      return 'This seal was retired and can no longer be transferred.';
    case 'token_suspended':
      return 'This seal is on hold and cannot be transferred right now.';
    case 'replay_detected':
    case 'invalid_signature':
      return 'We could not verify your tap. Tap the seal again to accept.';
    case '2fa_required':
      return 'Transfers need two-step sign-in. Once it’s done, try again.';
    default:
      break;
  }
  switch (error.code) {
    case 'permission_denied':
      return 'This transfer belongs to a different account. Sign in with the email address it was sent to.';
    case 'conflict':
      return 'This transfer is no longer pending. It may have been cancelled or already completed.';
    default:
      return error.message;
  }
};

/** Copy for a release the server refused. */
export const releaseErrorCopy = (reason: TokenErrorReason | null, fallback: string): string => {
  switch (reason) {
    case 'transfer_pending':
      return 'Cancel the pending transfer before you release this seal.';
    case 'token_released':
      return 'This seal has already been released.';
    case 'token_retired':
      return 'This seal was retired. There is nothing to release.';
    case 'token_suspended':
      return 'This seal is on hold and cannot be released right now.';
    case '2fa_required':
      return 'Releasing needs two-step sign-in. Once it’s done, try again.';
    default:
      return fallback;
  }
};

export const formatMoney = (minorUnits: number, currency: string): string =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(minorUnits / 100);
