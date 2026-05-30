import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import type { VerificationStatus } from '../types/sellerVerification';
import { VerificationStatusBadge } from './VerificationStatusBadge';

interface VerificationBannerProps {
  status: VerificationStatus;
  rejectionReason?: string | null;
}

export const VerificationBanner = ({ status, rejectionReason }: VerificationBannerProps) => {
  const navigate = useNavigate();

  if (status === 'APPROVED' || status === 'VERIFIED') return null;

  const messages: Record<string, { title: string; body: string; actionLabel?: string }> = {
    NONE: {
      title: 'Verification Required',
      body: 'Verify your identity with our hosted partner to start selling on the platform.',
      actionLabel: 'Start Verification',
    },
    PENDING: {
      title: 'Verification Under Review',
      body: 'Your identity verification is being processed. This usually completes within a few minutes.',
    },
    REJECTED: {
      title: 'Verification Needs Attention',
      body: rejectionReason || 'Your verification was not approved. You can retry the hosted verification flow.',
      actionLabel: 'Retry Verification',
    },
    REVOKED: {
      title: 'Verification Revoked',
      body: 'Your seller verification has been revoked. Please contact support for more information.',
    },
    FLAGGED: {
      title: 'Account Under Review',
      body: 'Your account has been flagged for additional review. Please wait for further instructions.',
    },
  };

  const msg = messages[status] || messages.NONE;

  return (
    <div className="glass rounded-2xl p-6 border border-white/10">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-yellow-500/20 flex items-center justify-center">
          <svg className="w-5 h-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-white font-semibold">{msg.title}</h3>
            <VerificationStatusBadge status={status} />
          </div>
          <p className="text-sm text-gray-400">{msg.body}</p>
          {msg.actionLabel && (
            <Button
              variant="primary"
              size="sm"
              className="mt-4"
              onClick={() => navigate('/seller/verification')}
            >
              {msg.actionLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
