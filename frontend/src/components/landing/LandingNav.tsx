import { Link, useLocation } from 'react-router-dom';
import { AMWordmark } from './AMWordmark';
import { useAuth } from '@/features/auth/hooks/useAuth';

const navLinks = [
  { to: '/collector', label: 'Collectors' },
  { to: '/creator', label: 'Creators' },
  { to: '/am-sealed', label: 'AM Sealed' },
  { to: '/am-proof', label: 'AM Proof' },
];

// Hide login/signup chrome on the live marketing domains; expose it everywhere
// else (staging cloudfront, localhost, preview builds) so the site is testable.
const PUBLIC_MARKETING_HOSTNAMES = [
  'authentic-materials.com',
  'www.authentic-materials.com',
  'collectxmrkt.com',
  'www.collectxmrkt.com',
];

function isPublicMarketingHost(): boolean {
  if (typeof window === 'undefined') return false;
  return PUBLIC_MARKETING_HOSTNAMES.includes(window.location.hostname);
}

export const LandingNav = () => {
  const location = useLocation();
  const { user, initialized } = useAuth();
  const showAuthChrome = !isPublicMarketingHost();
  const initial = user?.email?.[0]?.toUpperCase() ?? '?';

  return (
    <nav className="bg-dark-900" aria-label="Landing page navigation">
      <div className="max-w-6xl mx-auto px-4 py-5 flex items-center justify-between">
        <AMWordmark size="sm" />

        <div className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-900 rounded-sm ${
                location.pathname === link.to
                  ? 'text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {link.label}
            </Link>
          ))}

          <a
            href="#waitlist"
            className="text-sm font-medium text-gray-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-900 rounded-sm ml-2"
          >
            Join the list
          </a>

          {showAuthChrome && initialized && (
            user ? (
              <Link
                to="/my-listings"
                className="ml-2 flex items-center gap-2 text-sm font-medium text-gray-300 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-900 rounded-btn"
                aria-label={`Open dashboard for ${user.email ?? 'your account'}`}
              >
                <span className="w-8 h-8 rounded-full bg-gradient-primary flex items-center justify-center text-white text-xs font-semibold border border-white/10">
                  {initial}
                </span>
                Dashboard
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="ml-2 text-sm font-medium text-gray-300 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-900 rounded-sm"
                >
                  Log in
                </Link>
                <Link
                  to="/register"
                  className="text-sm font-semibold px-3 py-1.5 rounded-btn bg-gradient-primary border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  Sign up
                </Link>
              </>
            )
          )}
        </div>

        {/* Mobile */}
        <div className="flex md:hidden items-center gap-3">
          {showAuthChrome && initialized && user ? (
            <Link
              to="/my-listings"
              className="w-9 h-9 rounded-full bg-gradient-primary flex items-center justify-center text-white text-xs font-semibold border border-white/10 focus:outline-none focus:ring-2 focus:ring-primary-500"
              aria-label="Open dashboard"
            >
              {initial}
            </Link>
          ) : showAuthChrome && initialized ? (
            <Link
              to="/login"
              className="text-sm font-medium text-gray-300 hover:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 rounded-sm"
            >
              Log in
            </Link>
          ) : null}
          <a
            href="#waitlist"
            className="text-sm font-semibold px-3 py-1.5 rounded-btn bg-gradient-primary border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-primary-500 rounded-btn"
          >
            Join the list
          </a>
        </div>
      </div>
    </nav>
  );
};
