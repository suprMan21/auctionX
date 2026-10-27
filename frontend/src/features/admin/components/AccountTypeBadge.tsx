/**
 * Account type badge: Collector, Creator, or "Creator (verifying)" for an
 * account that asked to be a creator and has not passed the identity check.
 */

import type { AccountType } from '../api/accountSchemas';

export const accountTypeLabel = (type: AccountType, creatorPending: boolean): string => {
  if (type === 'creator') return 'Creator';
  return creatorPending ? 'Creator (verifying)' : 'Collector';
};

const STYLE = {
  creator: 'bg-primary-500/10 text-primary-300',
  pending: 'bg-warning-500/10 text-warning-500',
  collector: 'bg-white/5 text-gray-300',
} as const;

export const AccountTypeBadge = ({ type, creatorPending }: { type: AccountType; creatorPending: boolean }) => {
  const style = type === 'creator' ? STYLE.creator : creatorPending ? STYLE.pending : STYLE.collector;
  return (
    <span
      data-testid="account-type-badge"
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${style}`}
    >
      {accountTypeLabel(type, creatorPending)}
    </span>
  );
};
