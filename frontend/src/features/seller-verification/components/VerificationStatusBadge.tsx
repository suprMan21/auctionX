import type { VerificationStatus } from '../types/sellerVerification';

const STATUS_CONFIG: Record<VerificationStatus, { label: string; classes: string }> = {
  NONE: { label: 'Not Verified', classes: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
  PENDING: { label: 'Under Review', classes: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  APPROVED: { label: 'Verified', classes: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  REJECTED: { label: 'Rejected', classes: 'bg-red-500/20 text-red-400 border-red-500/30' },
  REVOKED: { label: 'Revoked', classes: 'bg-red-500/20 text-red-400 border-red-500/30' },
  FLAGGED: { label: 'Flagged', classes: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
};

interface VerificationStatusBadgeProps {
  status: VerificationStatus;
  size?: 'sm' | 'md';
}

export const VerificationStatusBadge = ({ status, size = 'sm' }: VerificationStatusBadgeProps) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.NONE;
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';

  return (
    <span className={`inline-flex items-center rounded-full border font-medium ${config.classes} ${sizeClasses}`}>
      {config.label}
    </span>
  );
};
