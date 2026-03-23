import { Link, useLocation } from 'react-router-dom';
import { AMWordmark } from './AMWordmark';

const navLinks = [
  { to: '/collector', label: 'Collectors' },
  { to: '/creator', label: 'Creators' },
  { to: '/am-sealed', label: 'AM Sealed' },
  { to: '/am-proof', label: 'AM Proof' },
];

export const LandingNav = () => {
  const location = useLocation();

  return (
    <nav className="bg-landing-dark" aria-label="Landing page navigation">
      <div className="max-w-6xl mx-auto px-4 py-5 flex items-center justify-between">
        <AMWordmark size="sm" />

        <div className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-landing-dark rounded-sm ${
                location.pathname === link.to
                  ? 'text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {link.label}
            </Link>
          ))}

          <Link
            to="/login"
            className="text-sm font-medium text-gray-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-landing-dark rounded-sm ml-2"
          >
            Log in
          </Link>
          <Link
            to="/register"
            className="text-sm font-semibold px-4 py-2 rounded-btn bg-gradient-primary border border-white/10 text-white shadow-glow hover:shadow-glow-intense hover:brightness-110 transition-all focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-landing-dark"
          >
            Sign up
          </Link>
        </div>

        {/* Mobile: minimal links */}
        <div className="flex md:hidden items-center gap-4">
          <Link
            to="/login"
            className="text-sm font-medium text-gray-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 rounded-sm"
          >
            Log in
          </Link>
          <Link
            to="/register"
            className="text-sm font-semibold px-3 py-1.5 rounded-btn bg-gradient-primary border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-primary-500 rounded-btn"
          >
            Sign up
          </Link>
        </div>
      </div>
    </nav>
  );
};
