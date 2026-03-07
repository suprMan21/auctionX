/**
 * Shared layout for all admin pages.
 * Renders a fixed sidebar with navigation links and a main content area via <Outlet />.
 * Mobile-responsive: hamburger button toggles the sidebar overlay.
 * @module Module 10 — Admin Dashboard
 */

import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { cn } from '@/lib/cn';

interface NavItem {
  /** Route path relative to /admin */
  to: string;
  /** Display label */
  label: string;
  /** SVG path string for icon */
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    to: '/admin',
    label: 'Dashboard',
    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  },
  {
    to: '/admin/users',
    label: 'Users',
    icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
  },
  {
    to: '/admin/moderation',
    label: 'Moderation',
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  },
  {
    to: '/admin/audit-logs',
    label: 'Audit Logs',
    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  },
  {
    to: '/admin/health',
    label: 'Health',
    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  },
];

/**
 * Icon rendered in the sidebar nav items.
 */
const NavIcon = ({ path }: { path: string }) => (
  <svg
    className="w-5 h-5 flex-shrink-0"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={path} />
  </svg>
);

/**
 * AdminLayout — sidebar navigation + main content area.
 * The sidebar collapses into a hamburger-toggled overlay on mobile.
 */
export const AdminLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { session, signOut } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors',
      isActive
        ? 'bg-primary-500/20 text-primary-400 border-l-2 border-primary-500'
        : 'text-gray-400 hover:text-white hover:bg-white/5'
    );

  const sidebar = (
    <aside className="w-64 flex-shrink-0 bg-dark-700 border-r border-white/10 flex flex-col h-full">
      {/* Logo */}
      <div className="p-6 border-b border-white/10">
        <span className="text-lg font-bold bg-gradient-to-r from-primary-400 to-accent-400 bg-clip-text text-transparent">
          Authentic Materials Admin
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-4 space-y-1" aria-label="Admin navigation">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/admin'}
            className={navLinkClass}
            onClick={() => setSidebarOpen(false)}
          >
            <NavIcon path={item.icon} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Admin info + logout */}
      <div className="p-4 border-t border-white/10">
        <p className="text-xs text-gray-400 truncate mb-3" title={session?.user.email}>
          {session?.user.email}
        </p>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-gray-400 hover:text-white hover:bg-white/5 transition-colors
                     focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-700"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Sign out
        </button>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-dark-800 flex">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:w-64">
        {sidebar}
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
          <div className="relative flex flex-col w-64 h-full">
            {sidebar}
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center gap-4 p-4 bg-dark-700 border-b border-white/10">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation menu"
            className="p-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/5 transition-colors
                       focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-700"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-white">Authentic Materials Admin</span>
        </header>

        <main className="flex-1 p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
