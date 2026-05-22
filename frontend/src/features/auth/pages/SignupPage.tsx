import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { useAuth } from '../hooks/useAuth';
import { BRAND_LABEL } from '@/constants/branding';

export function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState('');
  const { signUp, loading, error, clearError, user, initialized } = useAuth();
  const navigate = useNavigate();

  // Already authenticated → no reason to show a signup form. Send them to their
  // authenticated landing instead.
  useEffect(() => {
    if (initialized && user) {
      navigate('/my-listings', { replace: true });
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
      await signUp(email, password);
      navigate('/profile');
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
            Join {BRAND_LABEL.AUCTIONX} and start bidding on exclusive items.
          </p>

          <form onSubmit={handleSubmit} aria-label="Signup form" className="space-y-6">
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
