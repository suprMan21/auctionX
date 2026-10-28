/**
 * /register/confirmed: where the sign-up confirmation email lands when the
 * sign-up started in the Creator app (S-MOB1 Phase B). Supabase signs the
 * person in from the link; this page offers the way back to the app, or on
 * to the website.
 */

import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { OpenAppButton } from '@/features/app/OpenAppButton';
import { afterProfileLanding } from '@/features/profile/lib/landing';

export const EmailConfirmedPage = () => {
  const { user, initialized } = useAuth();
  const wantsCreator = user?.user_metadata?.account_intent === 'creator';
  const next = user ? (wantsCreator ? '/settings/account-type' : afterProfileLanding()) : '/login';

  return (
    <div className="min-h-screen bg-dark-800 flex items-center justify-center p-4">
      <main id="main-content" className="glass rounded-2xl p-8 max-w-md w-full space-y-5">
        <h1 className="text-2xl font-bold text-white">Your email is confirmed</h1>
        <p className="text-gray-300">
          {wantsCreator
            ? 'Next, verify your identity to become a creator. You can do it here on the website.'
            : 'Your account is ready.'}
        </p>
        {!initialized && <p className="text-sm text-gray-400" role="status">Loading…</p>}
        <OpenAppButton email={user?.email} />
        <Link
          to={next}
          className="block text-center text-sm font-medium text-accent-500 hover:text-accent-400 underline
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
        >
          {user ? (wantsCreator ? 'Become a creator on the website' : 'Continue on the website') : 'Sign in on the website'}
        </Link>
      </main>
    </div>
  );
};
