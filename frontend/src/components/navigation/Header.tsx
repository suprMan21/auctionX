import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { useAuth } from '@/features/auth/hooks/useAuth';

export function Header() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    if (trimmed) {
      navigate(`/search?q=${encodeURIComponent(trimmed)}`);
      setSearchQuery('');
      setMobileSearchOpen(false);
    }
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
              aria-label="AuctionX home"
            >
              AuctionX
            </Link>

            <ul className="hidden md:flex items-center gap-1" role="list">
              <li>
                <Link
                  to="/browse"
                  className="flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-xl
                             text-gray-300 hover:text-white hover:bg-white/5 transition-colors
                             focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
                >
                  Browse
                </Link>
              </li>
              {user && (
                <>
                  <li>
                    <Link
                      to="/dashboard"
                      className="flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-xl
                                 text-gray-300 hover:text-white hover:bg-white/5 transition-colors
                                 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
                    >
                      Dashboard
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/my-listings"
                      className="flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-xl
                                 text-gray-300 hover:text-white hover:bg-white/5 transition-colors
                                 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
                    >
                      My Listings
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/payouts"
                      className="flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-xl
                                 text-gray-300 hover:text-white hover:bg-white/5 transition-colors
                                 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
                    >
                      Payouts
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/create-listing"
                      className="flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-xl
                                 text-gray-300 hover:text-white hover:bg-white/5 transition-colors
                                 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
                    >
                      Create Listing
                    </Link>
                  </li>
                </>
              )}
            </ul>
          </div>

          {/* Desktop search */}
          <form
            onSubmit={handleSearchSubmit}
            role="search"
            className="hidden md:flex items-center gap-2 flex-1 max-w-xs mx-6"
          >
            <label htmlFor="header-search" className="sr-only">Search listings</label>
            <input
              id="header-search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search…"
              className="w-full h-9 px-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm
                         placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </form>

          <div className="flex items-center gap-3">
            {/* Mobile search toggle */}
            <button
              type="button"
              className="md:hidden flex items-center justify-center w-10 h-10 rounded-xl text-gray-300
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
                >
                  Sign Out
                </Button>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>

        {/* Mobile search overlay */}
        {mobileSearchOpen && (
          <div className="md:hidden border-t border-white/10 px-4 py-3">
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
                           placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
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
    </header>
  );
}
