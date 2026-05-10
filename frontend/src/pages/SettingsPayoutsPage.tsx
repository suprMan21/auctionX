import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Button } from '@/components/common/Button';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { api, type StripeConnectStatus } from '@/lib/api';

const STATUS_COPY: Record<
  StripeConnectStatus['status'],
  { badge: string; badgeClass: string; title: string; body: string; cta: string | null }
> = {
  not_started: {
    badge: 'Not connected',
    badgeClass: 'bg-dark-600 text-gray-300 border-white/10',
    title: 'Connect to receive your payouts',
    body: 'We use Stripe to send earnings straight to your bank. Onboarding takes about 3 minutes — Stripe collects identity and banking info and we never see it.',
    cta: 'Connect with Stripe',
  },
  pending: {
    badge: 'Onboarding in progress',
    badgeClass: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
    title: 'Finish your Stripe onboarding',
    body: 'Stripe still needs a few more details before we can send you money. Pick up where you left off.',
    cta: 'Resume onboarding',
  },
  active: {
    badge: 'Active',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    title: 'You’re ready to get paid',
    body: 'Payouts arrive in your bank within 2–5 business days after the buyer’s 72-hour escrow window closes.',
    cta: null,
  },
  restricted: {
    badge: 'Action required',
    badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    title: 'Stripe needs more info',
    body: 'Your account is paused until you update the requested details. Click below to fix it inside Stripe.',
    cta: 'Update info on Stripe',
  },
};

export function SettingsPayoutsPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<StripeConnectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);

  const refresh = async () => {
    try {
      const data = await api.stripeConnect.getStatus();
      setStatus(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load payout status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (searchParams.get('return') === '1' || searchParams.get('refresh') === '1') {
      // The webhook usually updates first, but re-fetch as a fallback so the
      // badge reflects reality immediately after the user returns from Stripe.
      refresh();
    }
  }, [searchParams]);

  const handleConnect = async () => {
    setRedirecting(true);
    try {
      const { url } = await api.stripeConnect.createOnboardingLink();
      window.location.href = url;
    } catch (err) {
      setRedirecting(false);
      toast.error(err instanceof Error ? err.message : 'Could not start Stripe onboarding');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-800 flex items-center justify-center">
        <p className="text-gray-400">Loading payout settings...</p>
      </div>
    );
  }

  const copy = STATUS_COPY[status?.status ?? 'not_started'];

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-dark-800 py-12 px-4">
        <main className="max-w-2xl mx-auto space-y-6">
          <header>
            <h1 className="text-3xl font-bold text-white mb-2">Payouts</h1>
            <p className="text-gray-400">
              Connect your bank through Stripe to receive earnings from your sales.
            </p>
          </header>

          <div className="glass rounded-2xl p-8 space-y-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-semibold text-white">Stripe Connect</h2>
              <span
                className={`px-3 py-1 rounded-full text-xs font-medium border ${copy.badgeClass}`}
              >
                {copy.badge}
              </span>
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-medium text-white">{copy.title}</h3>
              <p className="text-gray-400">{copy.body}</p>
              {status?.status === 'restricted' && status.disabledReason && (
                <p className="text-sm text-rose-300">
                  Stripe reason: <code className="text-rose-200">{status.disabledReason}</code>
                </p>
              )}
            </div>

            {copy.cta && (
              <Button
                variant="primary"
                size="lg"
                onClick={handleConnect}
                disabled={redirecting}
              >
                {redirecting ? 'Opening Stripe…' : copy.cta}
              </Button>
            )}

            {status?.status === 'active' && (
              <dl className="grid grid-cols-2 gap-4 text-sm pt-4 border-t border-white/5">
                <div>
                  <dt className="text-gray-400">Charges</dt>
                  <dd className="text-emerald-300">Enabled</dd>
                </div>
                <div>
                  <dt className="text-gray-400">Payouts</dt>
                  <dd className="text-emerald-300">Enabled</dd>
                </div>
              </dl>
            )}
          </div>
        </main>
      </div>
    </ErrorBoundary>
  );
}
