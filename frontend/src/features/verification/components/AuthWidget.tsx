import { VerificationStatus } from '../types/verification';
import { BRAND_LABEL } from '@/constants/branding';

interface AuthWidgetProps {
  status: VerificationStatus;
  tokenName: string;
}

const statusConfig: Record<
  VerificationStatus,
  { ringColor: string; iconColor: string; label: string }
> = {
  VERIFIED: {
    ringColor: 'bg-green-500/20 border border-green-500/40',
    iconColor: 'text-green-400',
    label: '✓ VERIFIED',
  },
  PENDING: {
    ringColor: 'bg-yellow-500/20 border border-yellow-500/40',
    iconColor: 'text-yellow-400',
    label: 'PENDING',
  },
  VIDEO_UPLOADED: {
    ringColor: 'bg-yellow-500/20 border border-yellow-500/40',
    iconColor: 'text-yellow-400',
    label: 'VIDEO UPLOADED',
  },
  NFC_PROGRAMMED: {
    ringColor: 'bg-yellow-500/20 border border-yellow-500/40',
    iconColor: 'text-yellow-400',
    label: 'NFC PROGRAMMED',
  },
  FLAGGED: {
    ringColor: 'bg-red-500/20 border border-red-500/40',
    iconColor: 'text-red-400',
    label: 'FLAGGED',
  },
  REVOKED: {
    ringColor: 'bg-red-500/20 border border-red-500/40',
    iconColor: 'text-red-400',
    label: 'REVOKED',
  },
};

const VerifiedIcon = ({ className }: { className: string }) => (
  <svg
    className={className}
    width="40"
    height="40"
    viewBox="0 0 40 40"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M20 3L4 10v10c0 9.4 6.8 18.2 16 20.4C29.2 38.2 36 29.4 36 20V10L20 3z"
      fill="currentColor"
      fillOpacity="0.15"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <path
      d="M14 20l4.5 4.5L27 15"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const PendingIcon = ({ className }: { className: string }) => (
  <svg
    className={className}
    width="40"
    height="40"
    viewBox="0 0 40 40"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle
      cx="20"
      cy="20"
      r="15"
      stroke="currentColor"
      strokeWidth="2"
      fill="currentColor"
      fillOpacity="0.1"
    />
    <path
      d="M20 12v8l5 3"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const WarningIcon = ({ className }: { className: string }) => (
  <svg
    className={className}
    width="40"
    height="40"
    viewBox="0 0 40 40"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M20 5L2 35h36L20 5z"
      fill="currentColor"
      fillOpacity="0.1"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <path d="M20 17v8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    <circle cx="20" cy="29" r="1.5" fill="currentColor" />
  </svg>
);

export const AuthWidget = ({ status, tokenName }: AuthWidgetProps) => {
  const config = statusConfig[status];
  const isVerified = status === 'VERIFIED';
  const isFlaggedOrRevoked = status === 'FLAGGED' || status === 'REVOKED';

  const statusTextColor = isVerified
    ? 'text-green-400'
    : isFlaggedOrRevoked
    ? 'text-red-400'
    : 'text-yellow-400';

  return (
    <div className="glass rounded-2xl p-8 w-full flex flex-col items-center gap-6">
      <div className="relative flex items-center justify-center" style={{ width: 160, height: 160 }}>
        <div
          className={`absolute rounded-full ${config.ringColor} ${isVerified ? 'animate-ping' : ''}`}
          style={{ width: 160, height: 160, animationDelay: '0.8s' }}
        />
        <div
          className={`absolute rounded-full ${config.ringColor} ${isVerified ? 'animate-ping' : ''}`}
          style={{ width: 120, height: 120, animationDelay: '0.4s' }}
        />
        <div
          className={`absolute rounded-full ${config.ringColor}`}
          style={{ width: 80, height: 80 }}
        />
        <div className="absolute flex items-center justify-center" style={{ width: 80, height: 80 }}>
          {isVerified ? (
            <VerifiedIcon className={config.iconColor} />
          ) : isFlaggedOrRevoked ? (
            <WarningIcon className={config.iconColor} />
          ) : (
            <PendingIcon className={config.iconColor} />
          )}
        </div>
      </div>

      <div className="flex flex-col items-center gap-1 text-center">
        <span className="bg-gradient-to-r from-primary-500 to-accent-500 bg-clip-text text-transparent text-xs tracking-widest font-semibold uppercase">
          {BRAND_LABEL.AUCTIONX}
        </span>
        <span className={`text-2xl font-bold ${statusTextColor}`}>{config.label}</span>
        <span className="font-mono text-sm text-gray-300">{tokenName}</span>
        <span className="text-xs text-gray-500">
          NTAG 424 DNA • NFC Cryptographic Authentication
        </span>
      </div>
    </div>
  );
};
