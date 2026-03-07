import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { NotificationBell } from '@/features/notifications/components/NotificationBell';

function useUnreadCount(userId: string | undefined) {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!userId) {
      setUnreadCount(0);
      return;
    }

    // Initial fetch: count unread messages not sent by the current user
    supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null)
      .neq('sender_id', userId)
      .then(({ count }) => {
        setUnreadCount(count ?? 0);
      });

    // Realtime: re-count on any INSERT into messages
    const channel = supabase
      .channel(`header:unread:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        () => {
          supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .is('read_at', null)
            .neq('sender_id', userId)
            .then(({ count }) => {
              setUnreadCount(count ?? 0);
            });
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        () => {
          supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .is('read_at', null)
            .neq('sender_id', userId)
            .then(({ count }) => {
              setUnreadCount(count ?? 0);
            });
        }
      )
      .subscribe();

    return () => { channel.unsubscribe(); };
  }, [userId]);

  return unreadCount;
}

const navLinkClass =
  'flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-xl text-gray-300 hover:text-white hover:bg-white/5 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800';

const mobileNavLinkClass =
  'flex items-center gap-3 w-full px-4 py-3 min-h-[44px] rounded-xl text-gray-300 hover:text-white hover:bg-white/5 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800';

export function Header() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const unreadCount = useUnreadCount(user?.id);
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const isUnmentionablesRoute = location.pathname.startsWith('/unmentionables');

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Close drawer on Escape
  useEffect(() => {
    if (!menuOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [menuOpen, closeMenu]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  const handleSignOut = async () => {
    await signOut();
    closeMenu();
    navigate('/login');
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    if (trimmed) {
      navigate(`/search?q=${encodeURIComponent(trimmed)}`);
      setSearchQuery('');
      setMobileSearchOpen(false);
      closeMenu();
    }
  };

  const handleMobileNavClick = () => {
    closeMenu();
  };

  return (
    <header className="glass sticky top-0 z-50 border-b border-white/10">
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8" aria-label="Main navigation">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-6">
            <Link
              to="/"
              className="text-2xl font-bold text-gradient
                         focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800 rounded"
              aria-label="Authentic Materials home"
            >
              Authentic Materials
            </Link>

            {/* Unmentionables context badge */}
            {isUnmentionablesRoute && (
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-unmentionables-500/10 border border-unmentionables-500/20 text-unmentionables-400 text-xs font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-unmentionables-500" aria-hidden="true" />
                18+
              </span>
            )}

            <ul className="hidden lg:flex items-center gap-1" role="list">
              <li>
                <Link to="/browse" className={navLinkClass}>
                  Browse
                </Link>
              </li>
              {user && (
                <>
                  <li>
                    <Link to="/dashboard" className={navLinkClass}>
                      Dashboard
                    </Link>
                  </li>
                  <li>
                    <Link to="/my-listings" className={navLinkClass}>
                      My Listings
                    </Link>
                  </li>
                  <li>
                    <Link to="/payouts" className={navLinkClass}>
                      Payouts
                    </Link>
                  </li>
                  <li>
                    <Link to="/messages" className={`relative ${navLinkClass}`}>
                      Messages
                      {unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-xs flex items-center justify-center font-semibold">
                          {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                      )}
                    </Link>
                  </li>
                  <li>
                    <Link to="/listings/create" className={navLinkClass}>
                      Create Listing
                    </Link>
                  </li>
                </>
              )}
              <li>
                <Link
                  to="/unmentionables"
                  className="flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-xl
                             text-unmentionables-400 hover:text-unmentionables-300 hover:bg-unmentionables-500/10 transition-colors
                             focus:outline-none focus:ring-2 focus:ring-unmentionables-500 focus:ring-offset-2 focus:ring-offset-dark-800"
                >
                  Unmentionables
                </Link>
              </li>
            </ul>
          </div>

          {/* Desktop search */}
          <form
            onSubmit={handleSearchSubmit}
            role="search"
            className="hidden lg:flex items-center gap-2 flex-1 max-w-xs mx-6"
          >
            <label htmlFor="header-search" className="sr-only">Search listings</label>
            <input
              id="header-search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search…"
              className="w-full h-9 px-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm
                         placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </form>

          <div className="flex items-center gap-3">
            {/* Mobile search toggle */}
            <button
              type="button"
              className="lg:hidden flex items-center justify-center w-10 h-10 rounded-xl text-gray-300
                         hover:text-white hover:bg-white/5 transition-colors focus:outline-none
                         focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
              aria-label={mobileSearchOpen ? 'Close search' : 'Open search'}
              aria-expanded={mobileSearchOpen}
              onClick={() => setMobileSearchOpen((o) => !o)}
            >
              {mobileSearchOpen ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                </svg>
              )}
            </button>

            {user ? (
              <>
                <NotificationBell userId={user.id} />
                <Link
                  to="/profile"
                  className="hidden sm:flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-xl
                             text-gray-300 hover:text-white hover:bg-white/5 transition-colors
                             focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
                  aria-label="View profile"
                >
                  Profile
                </Link>
                <Button
                  variant="ghost"
                  size="md"
                  onClick={handleSignOut}
                  aria-label="Sign out"
                  data-testid="logout-button"
                  className="hidden lg:inline-flex"
                >
                  Sign Out
                </Button>
              </>
            ) : (
              <div className="hidden lg:flex items-center gap-3">
                <Link to="/login">
                  <Button variant="ghost" size="md">
                    Log In
                  </Button>
                </Link>
                <Link to="/register">
                  <Button variant="primary" size="md">
                    Sign Up
                  </Button>
                </Link>
              </div>
            )}

            {/* Hamburger button */}
            <button
              type="button"
              className="lg:hidden flex items-center justify-center w-10 h-10 rounded-xl text-gray-300
                         hover:text-white hover:bg-white/5 transition-colors focus:outline-none
                         focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              onClick={() => setMenuOpen((o) => !o)}
            >
              {menuOpen ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile search overlay */}
        {mobileSearchOpen && (
          <div className="lg:hidden border-t border-white/10 px-4 py-3">
            <form onSubmit={handleSearchSubmit} role="search" className="flex gap-2">
              <label htmlFor="mobile-search" className="sr-only">Search listings</label>
              <input
                id="mobile-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search listings…"
                autoFocus
                className="flex-1 h-10 px-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm
                           placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <button
                type="submit"
                className="h-10 px-4 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-sm font-semibold
                           transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
              >
                Go
              </button>
            </form>
          </div>
        )}
      </nav>

      {/* Mobile drawer backdrop */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={closeMenu}
          aria-hidden="true"
        />
      )}

      {/* Mobile drawer panel */}
      <div
        id="mobile-nav"
        role="dialog"
        aria-modal="true"
        aria-label="Mobile navigation"
        className={`fixed top-0 right-0 z-50 h-full w-80 max-w-[85vw] bg-dark-800 border-l border-white/10
                     transform transition-transform duration-300 ease-in-out lg:hidden
                     ${menuOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-white/10">
          <span className="text-lg font-semibold text-white">Menu</span>
          <button
            type="button"
            onClick={closeMenu}
            className="flex items-center justify-center w-10 h-10 rounded-xl text-gray-300
                       hover:text-white hover:bg-white/5 transition-colors focus:outline-none
                       focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
            aria-label="Close menu"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Drawer content */}
        <div className="overflow-y-auto h-[calc(100%-4rem)] px-3 py-4">
          {/* Search */}
          <form onSubmit={handleSearchSubmit} role="search" className="mb-4">
            <label htmlFor="drawer-search" className="sr-only">Search listings</label>
            <div className="flex gap-2">
              <input
                id="drawer-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search listings…"
                className="flex-1 h-10 px-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm
                           placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <button
                type="submit"
                className="h-10 px-4 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-sm font-semibold
                           transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                Go
              </button>
            </div>
          </form>

          {/* Main nav */}
          <ul className="space-y-1" role="list">
            <li>
              <Link to="/browse" className={mobileNavLinkClass} onClick={handleMobileNavClick}>
                Browse
              </Link>
            </li>
            {user && (
              <>
                <li>
                  <Link to="/dashboard" className={mobileNavLinkClass} onClick={handleMobileNavClick}>
                    Dashboard
                  </Link>
                </li>
                <li>
                  <Link to="/my-listings" className={mobileNavLinkClass} onClick={handleMobileNavClick}>
                    My Listings
                  </Link>
                </li>
                <li>
                  <Link to="/payouts" className={mobileNavLinkClass} onClick={handleMobileNavClick}>
                    Payouts
                  </Link>
                </li>
                <li>
                  <Link to="/messages" className={`relative ${mobileNavLinkClass}`} onClick={handleMobileNavClick}>
                    Messages
                    {unreadCount > 0 && (
                      <span className="ml-auto w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center font-semibold">
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    )}
                  </Link>
                </li>
                <li>
                  <Link to="/listings/create" className={mobileNavLinkClass} onClick={handleMobileNavClick}>
                    Create Listing
                  </Link>
                </li>
                <li>
                  <Link to="/profile" className={mobileNavLinkClass} onClick={handleMobileNavClick}>
                    Profile
                  </Link>
                </li>
              </>
            )}
          </ul>

          {/* Unmentionables section */}
          <div className="border-t border-white/10 mt-4 pt-4">
            <Link
              to="/unmentionables"
              className="flex items-center gap-3 w-full px-4 py-3 min-h-[44px] rounded-xl
                         text-unmentionables-400 hover:text-unmentionables-300 hover:bg-unmentionables-500/10 transition-colors
                         focus:outline-none focus:ring-2 focus:ring-unmentionables-500 focus:ring-offset-2 focus:ring-offset-dark-800"
              onClick={handleMobileNavClick}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-unmentionables-500" aria-hidden="true" />
              Unmentionables
              <span className="ml-auto text-xs text-unmentionables-500/60">18+</span>
            </Link>
          </div>

          {/* Auth actions */}
          <div className="border-t border-white/10 mt-4 pt-4 space-y-1">
            {user ? (
              <button
                type="button"
                onClick={handleSignOut}
                className={mobileNavLinkClass}
              >
                Sign Out
              </button>
            ) : (
              <>
                <Link to="/login" className={mobileNavLinkClass} onClick={handleMobileNavClick}>
                  Log In
                </Link>
                <Link
                  to="/register"
                  className="flex items-center justify-center w-full px-4 py-3 min-h-[44px] rounded-xl
                             bg-gradient-primary text-white font-semibold hover:opacity-90 transition-opacity
                             focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
                  onClick={handleMobileNavClick}
                >
                  Sign Up
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
