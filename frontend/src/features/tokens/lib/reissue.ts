/**
 * Re-issue (S-ADMIN1 Ph2): where an owner's replacement request stands, in the
 * owner's terms. A replacement is only for a chip that is coming loose and is
 * still attached; a chip that has come off is not replaced.
 */

import type { OwnerReissue } from '../api/schemas';

export type ReissueStage = 'review' | 'pay' | 'preparing' | 'done' | 'rejected' | 'cancelled';

export const reissueStage = (r: OwnerReissue): ReissueStage => {
  if (r.fulfilledAt) return 'done';
  if (r.status === 'PENDING') return 'review';
  if (r.status === 'APPROVED' && r.paymentStatus === 'AWAITING_PAYMENT') return 'pay';
  if (r.status === 'APPROVED') return 'preparing';
  if (r.status === 'REJECTED') return 'rejected';
  return 'cancelled';
};

/** Still in progress: the owner should see it on the token page. */
export const isOpenReissue = (r: OwnerReissue): boolean => {
  const stage = reissueStage(r);
  return stage === 'review' || stage === 'pay' || stage === 'preparing';
};

export const REISSUE_STAGE_COPY: Record<ReissueStage, { title: string; body: string }> = {
  review: {
    title: 'Replacement requested.',
    body: 'We are reviewing your photos. You will get an email when we decide. Keep the chip on the item.',
  },
  pay: {
    title: 'Approved. Payment needed.',
    body: 'Pay the replacement fee and we will prepare your new chip. Keep the old chip on the item until it arrives.',
  },
  preparing: {
    title: 'We are preparing your new chip.',
    body: 'Keep the old chip on the item until the new one arrives. Your token moves to it when we activate it.',
  },
  done: {
    title: 'Your replacement chip is active.',
    body: 'The old chip is retired and no longer verifies. Your token has a new Ownership ID.',
  },
  rejected: {
    title: 'Replacement not approved.',
    body: 'Nothing was charged. Your token and its current chip are unchanged.',
  },
  cancelled: {
    title: 'Request cancelled.',
    body: 'Nothing was charged.',
  },
};

/** Where Stripe sends the browser back after a redirect-based payment. */
export const reissueReturnUrl = (requestId: string): string =>
  `${window.location.origin}/tokens/reissue/${encodeURIComponent(requestId)}/pay`;
