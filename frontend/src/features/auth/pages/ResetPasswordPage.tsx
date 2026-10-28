import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { ChangePasswordForm } from '@/features/security/components/ChangePasswordForm';

export const ResetPasswordPage = () => {
  const navigate = useNavigate();
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

  // S-2FA: the form asks for the second factor and a one-time permit when the
  // account has one; without it the database refuses the change.
  const finished = () => {
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

        {recoverySession === null
          ? <p className="text-center text-sm text-gray-400" role="status">Checking your reset link…</p>
          : <ChangePasswordForm onDone={finished} />}

        {recoverySession && (
          <p className="mt-4 text-center text-xs text-gray-400">
            Lost your passkey and authenticator app too?{' '}
            <Link to="/sign-in/recover" className="underline text-primary-300">Recover by email</Link>
            {' '}instead (it takes 72 hours).
          </p>
        )}

        <div className="mt-6 text-center">
          <Link to="/login" className="text-sm font-medium text-accent-500 hover:text-accent-400 transition-colors">
            Return to sign in
          </Link>
        </div>
      </div>
    </div>
  );
};
