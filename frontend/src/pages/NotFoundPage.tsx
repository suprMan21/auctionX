import { Link } from 'react-router-dom';

/**
 * 404 page.
 *
 * Replaces the previous `<Navigate to="/" />` catch-all so a direct visit to a
 * parked marketplace URL lands somewhere honest instead of being silently
 * bounced to the landing page (S-ISO1 acceptance).
 *
 * NOTE: a client-rendered SPA cannot emit a real HTTP 404 status. The `noindex`
 * hint keeps these out of search results; a host-level rewrite would be needed
 * for a true 404 status code, tracked in docs/PARKED_MARKETPLACE.md.
 */
export const NotFoundPage = () => {
  if (typeof document !== 'undefined') {
    const existing = document.querySelector('meta[name="robots"]');
    if (!existing) {
      const meta = document.createElement('meta');
      meta.name = 'robots';
      meta.content = 'noindex';
      document.head.appendChild(meta);
    }
  }

  return (
    <div className="min-h-screen bg-dark-800 flex items-center justify-center px-4">
      <div className="glass rounded-2xl p-10 max-w-md w-full text-center">
        <p className="text-6xl font-bold bg-gradient-to-r from-purple-500 to-blue-500 bg-clip-text text-transparent">
          404
        </p>
        <h1 className="mt-4 text-xl font-semibold text-white">Page not found</h1>
        <p className="mt-2 text-sm text-gray-400">
          This page doesn&apos;t exist, or it isn&apos;t available right now.
        </p>
        <Link
          to="/"
          className="mt-6 inline-block rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 px-5 py-2.5 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-800"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
};
