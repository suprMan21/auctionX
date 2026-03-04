/**
 * Route registry — single source of truth for all testable routes.
 * Used by visual.spec.ts, smoke.spec.ts, and Claude Code review skills.
 */

export interface TestRoute {
  /** Route pattern as defined in App.tsx */
  path: string;
  /** Resolved path for dynamic routes (placeholder IDs for empty-state/404 capture) */
  seedPath?: string;
  /** Kebab-case identifier — used as screenshot filename */
  name: string;
  /** Auth level required to access this route */
  auth: 'public' | 'user' | 'admin';
  /** Human-readable description for reports */
  description: string;
}

export const TEST_ROUTES: TestRoute[] = [
  // ── Public routes (10) ──────────────────────────────────────────────────────
  {
    path: '/login',
    name: 'login',
    auth: 'public',
    description: 'Login page',
  },
  {
    path: '/register',
    name: 'register',
    auth: 'public',
    description: 'Registration page',
  },
  {
    path: '/forgot-password',
    name: 'forgot-password',
    auth: 'public',
    description: 'Password reset page',
  },
  {
    path: '/browse',
    name: 'browse',
    auth: 'public',
    description: 'Browse listings (all categories)',
  },
  {
    path: '/browse/:categorySlug',
    seedPath: '/browse/sports',
    name: 'browse-category',
    auth: 'public',
    description: 'Browse listings filtered by category',
  },
  {
    path: '/search',
    seedPath: '/search?q=test',
    name: 'search',
    auth: 'public',
    description: 'Search results page',
  },
  {
    path: '/listings/:id',
    seedPath: '/listings/00000000-0000-0000-0000-000000000000',
    name: 'listing-detail',
    auth: 'public',
    description: 'Individual listing detail page',
  },
  {
    path: '/auctions/:id',
    seedPath: '/auctions/00000000-0000-0000-0000-000000000000',
    name: 'auction-detail',
    auth: 'public',
    description: 'Auction detail page with bidding UI',
  },
  {
    path: '/verify/:tokenName',
    seedPath: '/verify/test-token',
    name: 'verify-public',
    auth: 'public',
    description: 'Public NFC verification page',
  },
  {
    path: '/seller/:id',
    seedPath: '/seller/00000000-0000-0000-0000-000000000000',
    name: 'seller-profile',
    auth: 'public',
    description: 'Public seller profile page',
  },

  // ── User routes (12) — require authentication ───────────────────────────────
  {
    path: '/profile',
    name: 'profile',
    auth: 'user',
    description: 'User profile page',
  },
  {
    path: '/my-listings',
    name: 'my-listings',
    auth: 'user',
    description: 'Dashboard — user\'s own listings',
  },
  {
    path: '/listings/create',
    name: 'create-listing',
    auth: 'user',
    description: 'Create new listing form',
  },
  {
    path: '/listings/:id/edit',
    seedPath: '/listings/00000000-0000-0000-0000-000000000000/edit',
    name: 'edit-listing',
    auth: 'user',
    description: 'Edit existing listing form',
  },
  {
    path: '/verify/create/:verificationId',
    seedPath: '/verify/create/00000000-0000-0000-0000-000000000000',
    name: 'token-creation',
    auth: 'user',
    description: 'NFC token creation wizard',
  },
  {
    path: '/settlements/:settlementId',
    seedPath: '/settlements/00000000-0000-0000-0000-000000000000',
    name: 'settlement',
    auth: 'user',
    description: 'Auction settlement page',
  },
  {
    path: '/payouts',
    name: 'payouts',
    auth: 'user',
    description: 'Seller payouts page',
  },
  {
    path: '/saved-searches',
    name: 'saved-searches',
    auth: 'user',
    description: 'Saved search queries',
  },
  {
    path: '/messages',
    name: 'messages',
    auth: 'user',
    description: 'Conversations list',
  },
  {
    path: '/messages/:conversationId',
    seedPath: '/messages/00000000-0000-0000-0000-000000000000',
    name: 'message-thread',
    auth: 'user',
    description: 'Individual conversation thread',
  },
  {
    path: '/notifications',
    name: 'notifications',
    auth: 'user',
    description: 'Notifications list',
  },
  {
    path: '/settings/notifications',
    name: 'notification-preferences',
    auth: 'user',
    description: 'Notification preference toggles',
  },

  // ── Admin routes (6) — require admin role ───────────────────────────────────
  {
    path: '/admin',
    name: 'admin-dashboard',
    auth: 'admin',
    description: 'Admin dashboard overview',
  },
  {
    path: '/admin/users',
    name: 'admin-users',
    auth: 'admin',
    description: 'Admin user management list',
  },
  {
    path: '/admin/users/:id',
    seedPath: '/admin/users/00000000-0000-0000-0000-000000000000',
    name: 'admin-user-detail',
    auth: 'admin',
    description: 'Admin user detail/actions page',
  },
  {
    path: '/admin/moderation',
    name: 'admin-moderation',
    auth: 'admin',
    description: 'Content moderation queue',
  },
  {
    path: '/admin/audit-logs',
    name: 'admin-audit-logs',
    auth: 'admin',
    description: 'System audit log viewer',
  },
  {
    path: '/admin/health',
    name: 'admin-health',
    auth: 'admin',
    description: 'System health dashboard',
  },
];

/** Helper: get the navigable URL for a route (uses seedPath for dynamic routes) */
export function getRoutePath(route: TestRoute): string {
  return route.seedPath ?? route.path;
}
