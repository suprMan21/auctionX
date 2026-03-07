/**
 * Route guard for admin-only pages.
 * Renders an Outlet when the user is authenticated AND present in admin_users.
 * Redirects unauthenticated users to /login, non-admins to /.
 * @module Module 10 — Admin Dashboard
 */

import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { supabase } from '@/lib/supabase';

type CheckState = 'loading' | 'admin' | 'not-admin' | 'unauthenticated';

/**
 * AdminProtectedRoute guards all /admin/* routes.
 * On mount it verifies the session then queries admin_users for the current user ID.
 * While checking it renders a full-screen spinner to prevent flash-of-content.
 */
export const AdminProtectedRoute = () => {
  const { session, loading: authLoading, initialized } = useAuth();
  const [checkState, setCheckState] = useState<CheckState>('loading');

  useEffect(() => {
    if (authLoading || !initialized) return;

    if (!session) {
      setCheckState('unauthenticated');
      return;
    }

    const check = async () => {
      try {
        const { data } = await supabase
          .from('admin_users')
          .select('admin_id')
          .eq('admin_id', session.user.id)
          .eq('is_active', true)
          .single();
        setCheckState(data ? 'admin' : 'not-admin');
      } catch {
        setCheckState('not-admin');
      }
    };
    check();
  }, [session, authLoading, initialized]);

  if (!initialized || authLoading || checkState === 'loading') {
    return (
      <div className="min-h-screen bg-dark-800 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Verifying admin access…</p>
        </div>
      </div>
    );
  }

  if (checkState === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }

  if (checkState === 'not-admin') {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};
