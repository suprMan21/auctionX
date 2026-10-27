import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { sessionKeyOf, useMfaStore } from '../store/mfaStore';
import { secondFactorPathFor } from '../lib/stepUp';

export const SETUP_PATH = '/settings/security/setup';

/**
 * Inside ProtectedRoute. Only acts when the server says two-step sign-in is
 * required for this account (FEATURE_REQUIRE_2FA, or a staff account with the
 * admin flag): no method yet → setup page; a method but this session has not
 * used it → the sign-in second step. If the status cannot be loaded the page
 * renders: the server refuses every gated action on its own, so this guard is
 * for the person's convenience, never the security boundary.
 */
export const SecondFactorGate = ({ session, children }: { session: Session; children: ReactNode }) => {
  const location = useLocation();
  const { status, sessionKey, ensure } = useMfaStore();
  const key = sessionKeyOf(session.access_token, session.user.id);

  useEffect(() => {
    void ensure(key);
  }, [key, ensure]);

  const current = sessionKey === key ? status : null;
  const here = location.pathname + location.search;

  if (current?.secondFactorRequired) {
    if (current.enrolmentRequired && location.pathname !== SETUP_PATH) {
      return <Navigate to={`${SETUP_PATH}?next=${encodeURIComponent(here)}`} replace />;
    }
    if (current.hasFactor && !current.sessionVerified) {
      return <Navigate to={secondFactorPathFor(here)} replace />;
    }
  }
  return <>{children}</>;
};
