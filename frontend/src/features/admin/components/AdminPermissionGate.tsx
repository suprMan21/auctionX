/**
 * Shows its children only to admins holding `permission` (S-ADMIN2: one
 * permission model). Others see a short note. Display only: the API returns
 * 403 anyway.
 */

import type { ReactNode } from 'react';
import { hasPermission, useAdminRole } from '../lib/adminRole';

/** `permission` may be a list: holding any one of them is enough. */
export const AdminPermissionGate = ({ permission, children }: { permission: string | readonly string[]; children: ReactNode }) => {
  const access = useAdminRole();
  if (access.status === 'loading') {
    return (
      <div className="flex items-center justify-center h-48" role="status" aria-label="Checking your access">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  const needed: readonly string[] = typeof permission === 'string' ? [permission] : permission;
  if (!needed.some((p) => hasPermission(access, p))) {
    return (
      <div className="glass rounded-2xl p-6">
        <h1 className="text-xl font-semibold text-white mb-2">Not available for your staff role</h1>
        <p className="text-gray-400 text-sm">Your staff role does not include this page. Ask a super admin if you need access.</p>
      </div>
    );
  }
  return <>{children}</>;
};
