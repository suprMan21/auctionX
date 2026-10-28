/**
 * /app/open: the link the website uses to send people back to the Creator app.
 *
 * On a phone with the app installed, the phone opens the app instead of this
 * page. Seeing this page means the app did not open, most likely because it
 * isn't installed yet. The page makes no API call and never redirects.
 */

const httpsOrNull = (value: string | undefined): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
};

const linkClass =
  'block w-full text-center min-h-[44px] px-6 py-3 rounded-btn font-semibold text-white glass hover:bg-white/[0.07] ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-800';

/**
 * Tester install links come in as props: the staging app passes its build
 * settings, the public site (which reads no build settings) passes none and
 * shows the "ask for an invite" line.
 */
export const AppOpenPage = ({ testFlightUrl, playTestingUrl }: { testFlightUrl?: string; playTestingUrl?: string } = {}) => {
  const testFlight = httpsOrNull(testFlightUrl);
  const playTesting = httpsOrNull(playTestingUrl);

  return (
    <div className="min-h-screen bg-dark-800 flex items-center justify-center p-4">
      <main id="main-content" className="glass rounded-2xl p-8 max-w-md w-full space-y-5">
        <h1 className="text-2xl font-bold text-white">Opening the app…</h1>
        <p className="text-gray-300">
          If the Authentic Materials app didn&apos;t open, it isn&apos;t installed on this phone yet.
        </p>
        <p className="text-gray-400 text-sm">
          The app is in testing. Install it from your tester invite, then come back and tap the button again.
        </p>

        {testFlight || playTesting ? (
          <div className="flex flex-col gap-3">
            {testFlight && <a className={linkClass} href={testFlight}>Get the app for iPhone (TestFlight)</a>}
            {playTesting && <a className={linkClass} href={playTesting}>Get the app for Android (Google Play testing)</a>}
          </div>
        ) : (
          <p className="text-gray-300">
            Ask Authentic Materials for a tester invite at{' '}
            <a className="text-accent-500 underline" href="mailto:hello@authentic-materials.com">hello@authentic-materials.com</a>.
          </p>
        )}
      </main>
    </div>
  );
};
