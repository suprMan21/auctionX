import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

export const ResetPasswordPage = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [recoverySession, setRecoverySession] = useState<boolean | null>(null);

  // Supabase places the recovery session in the URL hash on redirect.
  // The supabase-js client picks it up automatically; we only need to verify
  // a session exists and was created via the PASSWORD_RECOVERY event before
  // letting the user submit.
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setRecoverySession(!!data.session);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setRecoverySession(!!session);
      }
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateErr) {
      setError(updateErr.message);
      return;
    }

    setDone(true);
    setTimeout(() => navigate('/login'), 2500);
  };

  if (recoverySession === false) {
    return (
      <div className="min-h-screen bg-dark-800 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-gradient-to-b from-primary-500/10 via-dark-800 to-dark-800 pointer-events-none" />
        <div className="relative glass rounded-2xl p-8 max-w-md w-full">
          <div className="glass rounded-xl border-red-500/30 p-4 mb-6">
            <h3 className="text-sm font-medium text-red-400">Reset link invalid or expired</h3>
            <p className="mt-2 text-sm text-red-400/80">
              This password reset link can&apos;t be used. It may have expired (links are valid for 1 hour) or already been used.
              Request a new one to continue.
            </p>
          </div>
          <div className="text-center">
            <Link
              to="/forgot-password"
              className="text-sm font-medium text-accent-500 hover:text-accent-400 transition-colors"
            >
              Request a new reset link
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-dark-800 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-gradient-to-b from-primary-500/10 via-dark-800 to-dark-800 pointer-events-none" />
        <div className="relative glass rounded-2xl p-8 max-w-md w-full">
          <div className="glass rounded-xl border-green-500/30 p-4 mb-6">
            <h3 className="text-sm font-medium text-green-400">Password updated</h3>
            <p className="mt-2 text-sm text-green-400/80">
              Your new password is set. Redirecting you to sign in…
            </p>
          </div>
          <div className="text-center">
            <Link to="/login" className="text-sm font-medium text-accent-500 hover:text-accent-400 transition-colors">
              Continue to sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-800 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gradient-to-b from-primary-500/10 via-dark-800 to-dark-800 pointer-events-none" />
      <div className="relative glass rounded-2xl p-8 max-w-md w-full">
        <h2 className="text-3xl font-bold text-white text-center mb-2">Choose a new password</h2>
        <p className="text-center text-sm text-gray-400 mb-8">
          Enter and confirm a new password for your account.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1">
              New password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full h-11 px-3 rounded-xl bg-dark-600 border border-white/10 text-white
                         placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          <div>
            <label htmlFor="confirm" className="block text-sm font-medium text-gray-300 mb-1">
              Confirm new password
            </label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
              className="w-full h-11 px-3 rounded-xl bg-dark-600 border border-white/10 text-white
                         placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {error && (
            <div className="glass rounded-xl border-red-500/30 p-4">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || recoverySession === null}
            className="w-full h-11 rounded-xl bg-gradient-to-r from-primary-500 to-accent-500 text-white font-semibold
                       hover:shadow-glow transition-all duration-200
                       focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Updating…' : 'Set new password'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <Link to="/login" className="text-sm font-medium text-accent-500 hover:text-accent-400 transition-colors">
            Return to sign in
          </Link>
        </div>
      </div>
    </div>
  );
};
