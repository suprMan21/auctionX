import { useLocation, useNavigate } from 'react-router-dom';

export const ProductToggle = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const isSealed = location.pathname === '/am-sealed';

  return (
    <div className="w-full max-w-3xl mx-auto text-center pt-12 pb-8 px-4">
      <p className="text-gray-400 text-sm tracking-wide uppercase mb-6">
        Two seals. One standard. The story stays with the piece.
      </p>
      <div className="inline-flex rounded-2xl p-1 glass" role="tablist" aria-label="Authentication product">
        <button
          role="tab"
          aria-selected={isSealed}
          onClick={() => navigate('/am-sealed')}
          className={`px-6 py-3 rounded-xl text-sm font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-landing-dark ${
            isSealed
              ? 'bg-gradient-primary text-white shadow-glow'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          AM Sealed
        </button>
        <button
          role="tab"
          aria-selected={!isSealed}
          onClick={() => navigate('/am-proof')}
          className={`px-6 py-3 rounded-xl text-sm font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-accent-500 focus:ring-offset-2 focus:ring-offset-landing-dark ${
            !isSealed
              ? 'bg-gradient-to-r from-accent-500 to-accent-600 text-white shadow-[0_4px_24px_rgba(59,130,246,0.25)]'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          AM Proof
        </button>
      </div>
    </div>
  );
};
