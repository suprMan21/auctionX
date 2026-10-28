import { Link, useLocation } from 'react-router-dom';
import { useMfaStore } from '../store/mfaStore';
import { secondFactorPathFor } from '../lib/stepUp';
import { SETUP_PATH } from './SecondFactorGate';

/**
 * S-2FA Ph4: shown under a token action the server refused with `2fa_required`.
 * Collectors are first asked here (not at sign-in), so most will have no method
 * yet: send them to setup. Someone with a method only needs to confirm it.
 * Both come back to this page afterwards.
 */
export const SecondFactorNeeded = () => {
  const location = useLocation();
  const hasFactor = useMfaStore((s) => s.status?.hasFactor ?? false);
  const here = location.pathname + location.search;
  const to = hasFactor ? secondFactorPathFor(here) : `${SETUP_PATH}?next=${encodeURIComponent(here)}`;
  return (
    <p className="mt-2 text-sm">
      <Link to={to} className="underline text-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-500 rounded">
        {hasFactor ? 'Confirm it’s you' : 'Set up two-step sign-in'}
      </Link>
    </p>
  );
};
