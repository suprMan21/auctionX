import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { signIn, checkProfileComplete, loading, error, clearError } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    try {
      await signIn(email, password);

      const { data: { session } } = await supabase.auth.getSession();

      if (session?.user) {
        const isProfileComplete = await checkProfileComplete(session.user.id);
        navigate(isProfileComplete ? '/my-listings' : '/profile');
      } else {
        navigate('/my-listings');
      }
    } catch (err) {
      console.error('Login error:', err);
    }
  };

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
            Log in to Authentic Materials
          </h1>
          <p className="text-gray-400 mb-8">
            Welcome back! Enter your credentials to continue.
          </p>

          <form onSubmit={handleSubmit} aria-label="Login form" className="space-y-6">
            <div>
              <h2 className="sr-only">Account Credentials</h2>
              
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
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              error={error ?? undefined}
            />

            <Button type="submit" variant="primary" size="lg" fullWidth disabled={loading}>
              {loading ? 'Signing in...' : 'Log In'}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <Link 
              to="/forgot-password"
              className="text-gray-400 hover:text-gray-300 text-sm underline
                         focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800 rounded"
            >
              Forgot password?
            </Link>
          </div>

          <p className="mt-6 text-center text-gray-400">
            Don't have an account?{' '}
            <Link 
              to="/register"
              className="text-accent-500 hover:text-accent-400 underline font-medium
                         focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800 rounded"
            >
              Sign up
            </Link>
          </p>
        </main>
      </div>
    </ErrorBoundary>
  );
}
