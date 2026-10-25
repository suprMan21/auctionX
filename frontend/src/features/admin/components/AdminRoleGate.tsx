/**
 * Shows its children only to the given admin roles (S-ADMIN1 Ph3b). Other
 * admins see a short note instead. Display only: the API returns 403 anyway.
 */

import type { ReactNode } from 'react';
import { hasAdminRole, useAdminRole } from '../lib/adminRole';

export const AdminRoleGate = ({ roles, children }: { roles: readonly string[]; children: ReactNode }) => {
  const role = useAdminRole();
  if (role.status === 'loading') {
    return (
      <div className="flex items-center justify-center h-48" role="status" aria-label="Checking your access">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!hasAdminRole(role, roles)) {
    return (
      <div className="glass rounded-2xl p-6">
        <h1 className="text-xl font-semibold text-white mb-2">Admins only</h1>
        <p className="text-gray-400 text-sm">This page needs an admin or super admin. Ask one if you need a change made here.</p>
      </div>
    );
  }
  return <>{children}</>;
};
