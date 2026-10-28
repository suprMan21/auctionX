import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { appOpenHref, captureFromApp, isFromApp } from './fromApp';

/**
 * "Open the Authentic Materials app", shown only when this visit started in
 * the app. A plain link (full page load) to the fixed `/app/open` path, which
 * the phone hands to the app.
 */
export const OpenAppButton = ({ email, className = '' }: { email?: string | null; className?: string }) => {
  const { search } = useLocation();
  if (!isFromApp(search)) return null;
  return (
    <a
      href={appOpenHref(email)}
      className={`inline-flex items-center justify-center min-h-[44px] px-6 py-3 w-full rounded-btn font-semibold text-white
                  bg-gradient-primary border border-white/10 shadow-glow hover:brightness-110
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-800
                  ${className}`}
    >
      Open the Authentic Materials app
    </a>
  );
};

/** Remembers `?from=app` for this tab on whichever page it arrives. Renders nothing. */
export const FromAppCapture = () => {
  const { search } = useLocation();
  useEffect(() => {
    captureFromApp(search);
  }, [search]);
  return null;
};
