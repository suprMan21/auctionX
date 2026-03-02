import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { useAuth } from '@/features/auth/hooks/useAuth';

export function Header() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <header className="glass sticky top-0 z-50 border-b border-white/10">
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8" aria-label="Main navigation">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-8">
            <Link 
              to="/"
              className="text-2xl font-bold text-gradient
                         focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800 rounded"
              aria-label="AuctionX home"
            >
              AuctionX
            </Link>

            {user && (
              <ul className="hidden md:flex items-center gap-2" role="list">
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
                    to="/create-listing"
                    className="flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-xl
                               text-gray-300 hover:text-white hover:bg-white/5 transition-colors
                               focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
                  >
                    Create Listing
                  </Link>
                </li>
              </ul>
            )}
          </div>

          <div className="flex items-center gap-3">
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
      </nav>
    </header>
  );
}
