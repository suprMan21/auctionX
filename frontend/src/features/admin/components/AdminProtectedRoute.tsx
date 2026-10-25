/**
 * Route guard for admin-only pages.
 * Renders an Outlet when the signed-in user is an active admin, per the
 * backend (GET /admin/me), and provides their role + permissions to the
 * console. Unauthenticated → /login; not an admin (or a suspended/retired
 * account) → /.
 * @module Module 10 — Admin Dashboard (S-ADMIN2 Ph1)
 */

import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { AdminApiError, adminApi } from '../api/adminApi';
import { AdminRoleContext, type AdminAccessState } from '../lib/adminRole';

type CheckState = 'loading' | 'admin' | 'not-admin' | 'unauthenticated' | 'needs-2fa' | 'error';
type Checked = { userId: string; state: Exclude<CheckState, 'loading' | 'unauthenticated'>; access: AdminAccessState };

export const AdminProtectedRoute = () => {
  const { session, loading: authLoading, initialized } = useAuth();
  const [checked, setChecked] = useState<Checked | null>(null);
  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (authLoading || !initialized || !userId) return;
    let cancelled = false;
    adminApi
      .getMe()
      .then((me) => {
        if (!cancelled) {
          setChecked({ userId, state: 'admin', access: { status: 'known', role: me.role, permissions: me.permissions, adminId: me.adminId } });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const state: Checked['state'] =
          err instanceof AdminApiError && err.code === 'ADMIN_2FA_REQUIRED' ? 'needs-2fa'
            : err instanceof AdminApiError && (err.status === 401 || err.status === 403) ? 'not-admin'
              : 'error';
        setChecked({ userId, state, access: { status: 'loading' } });
      });
    return () => { cancelled = true; };
  }, [userId, authLoading, initialized]);

  const checkState: CheckState =
    !initialized || authLoading ? 'loading'
      : !userId ? 'unauthenticated'
        : checked?.userId !== userId ? 'loading'
          : checked.state;
  const access: AdminAccessState = checkState === 'admin' && checked ? checked.access : { status: 'loading' };

  if (checkState === 'loading') {
    return (
      <div className="min-h-screen bg-dark-800 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Verifying admin access…</p>
        </div>
      </div>
    );
  }

  if (checkState === 'unauthenticated') return <Navigate to="/login" replace />;
  if (checkState === 'not-admin') return <Navigate to="/" replace />;

  if (checkState === 'needs-2fa' || checkState === 'error') {
    return (
      <div className="min-h-screen bg-dark-800 flex items-center justify-center p-4">
        <div className="glass rounded-2xl p-6 max-w-md" role="alert">
          <h1 className="text-xl font-semibold text-white mb-2">
            {checkState === 'needs-2fa' ? 'Two-factor sign-in needed' : 'Admin console unavailable'}
          </h1>
          <p className="text-gray-400 text-sm">
            {checkState === 'needs-2fa'
              ? 'The admin console needs a second factor. Sign in again with your security key or authenticator.'
              : 'Your admin access could not be checked. Try again in a moment.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <AdminRoleContext.Provider value={access}>
      <Outlet />
    </AdminRoleContext.Provider>
  );
};
