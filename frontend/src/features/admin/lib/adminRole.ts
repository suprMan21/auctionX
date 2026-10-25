/**
 * The signed-in admin's role, for showing or hiding role-specific admin UI
 * (S-ADMIN1 Ph3b). Display only: the API enforces every role check itself.
 *
 * AdminProtectedRoute reads the role from admin_users -> admin_roles and
 * provides it here. Unknown (still loading, or the lookup failed) hides
 * anything role-gated.
 */

import { createContext, useContext } from 'react';

export type AdminRoleState = { status: 'loading' } | { status: 'known'; role: string | null };

export const AdminRoleContext = createContext<AdminRoleState>({ status: 'loading' });

export const useAdminRole = (): AdminRoleState => useContext(AdminRoleContext);

/** Prices and free-transfer vouchers: admin and super_admin only (Locked 2026-10-03). */
export const PRICING_ROLES: readonly string[] = ['admin', 'super_admin'];

export const hasAdminRole = (state: AdminRoleState, roles: readonly string[]): boolean =>
  state.status === 'known' && state.role !== null && roles.includes(state.role);

/** admin_roles comes back as an object or a one-item array depending on the embed. */
export const roleNameFrom = (embedded: unknown): string | null => {
  const row = Array.isArray(embedded) ? embedded[0] : embedded;
  if (row && typeof row === 'object' && 'role_name' in row && typeof row.role_name === 'string') return row.role_name;
  return null;
};
