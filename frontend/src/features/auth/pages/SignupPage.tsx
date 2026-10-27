import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { useAuth } from '../hooks/useAuth';
import { BRAND_LABEL } from '@/constants/branding';
import { afterProfileLanding } from '@/features/profile/lib/landing';
import type { AccountIntent } from '../store/authStore';

const ACCOUNT_CHOICES: ReadonlyArray<{ value: AccountIntent; label: string; hint: string }> = [
  { value: 'collector', label: 'A collector', hint: 'Verify seals and keep a record of the items you own.' },
  { value: 'creator', label: 'A creator', hint: "Seal your own items. We'll ask you to verify your identity next." },
];

export function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState('');
  const [accountIntent, setAccountIntent] = useState<AccountIntent>('collector');
  const { signUp, loading, error, clearError, user, initialized } = useAuth();
  const navigate = useNavigate();

  // Already authenticated → no reason to show a signup form. Send them to their
  // authenticated landing instead.
  useEffect(() => {
    if (initialized && user) {
      navigate(afterProfileLanding(), { replace: true });
    }
  }, [initialized, user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setLocalError('');

    if (password !== confirmPassword) {
      setLocalError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setLocalError('Password must be at least 6 characters');
      return;
    }

    try {
      await signUp(email, password, accountIntent);
      // A creator goes straight to the identity check; a collector to their profile.
      navigate(accountIntent === 'creator' ? '/settings/account-type' : '/profile');
    } catch (err) {
      console.error('Signup error:', err);
    }
  };

  const displayError = error || localError;

  return (
    <ErrorBoundary>
      <a 
        href="#main-content" 
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 
                   bg-primary-500 text-white px-4 py-2 rounded-lg z-50
                   focus:outline-none focus:ring-2 focus:ring-white"
      >
        Skip to main content
      </a>

      <div className="min-h-screen bg-dark-800 flex items-center justify-center p-4">
        <main id="main-content" className="glass rounded-2xl p-8 max-w-md w-full">
          <h1 className="text-3xl font-bold text-white mb-2">
            Create your account
          </h1>
          <p className="text-gray-400 mb-8">
            Join {BRAND_LABEL.AUCTIONX}.
          </p>

          <form onSubmit={handleSubmit} aria-label="Signup form" className="space-y-6">
            <fieldset>
              <legend className="block text-sm font-medium text-gray-300 mb-2">I'm joining as</legend>
              <div className="grid gap-3">
                {ACCOUNT_CHOICES.map((c) => (
                  <label
                    key={c.value}
                    className={`flex gap-3 items-start rounded-xl border p-3 cursor-pointer focus-within:ring-2 focus-within:ring-primary-500 ${
                      accountIntent === c.value ? 'border-primary-500 bg-primary-500/10' : 'border-white/10'
                    }`}
                  >
                    <input
                      type="radio"
                      name="account-intent"
                      value={c.value}
                      checked={accountIntent === c.value}
                      onChange={() => setAccountIntent(c.value)}
                      className="mt-1 accent-primary-500"
                    />
                    <span>
                      <span className="block text-white font-medium">{c.label}</span>
                      <span className="block text-sm text-gray-400">{c.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <h2 className="sr-only">Account Information</h2>
              
              <Input
                label="Email Address"
                id="email"
                type="email"
                name="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>

            <Input
              label="Password"
              id="password"
              type="password"
              name="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              helperText="Minimum 6 characters"
            />

            <Input
              label="Confirm Password"
              id="confirm-password"
              type="password"
              name="confirm-password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              error={displayError}
            />

            <Button type="submit" variant="primary" size="lg" fullWidth disabled={loading}>
              {loading ? 'Creating account...' : 'Sign Up'}
            </Button>
          </form>

          <p className="mt-6 text-center text-gray-400">
            Already have an account?{' '}
            <Link 
              to="/login" 
              className="text-accent-500 hover:text-accent-400 underline font-medium
                         focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800 rounded"
            >
              Log in
            </Link>
          </p>
        </main>
      </div>
    </ErrorBoundary>
  );
}
