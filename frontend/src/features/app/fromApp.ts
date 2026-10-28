/**
 * S-MOB1 Phase B: "this visit started in the Creator app".
 *
 * The app opens the website with the fixed flag `?from=app` (sign-up, forgot
 * password, account type, recovery). The flag is kept for this browser tab and
 * carried through email links as the same fixed query param, so the finish
 * screens can offer "Open the Authentic Materials app". Visits that did not
 * start in the app never see that button (Boss 2026-10-28).
 *
 * The link back is always the fixed path `/app/open`, with at most the
 * person's own email as a hint. Nothing from the URL can change where it
 * points, and it never carries a token or a session.
 */

export const FROM_APP_PARAM = 'from';
export const FROM_APP_VALUE = 'app';
export const APP_OPEN_PATH = '/app/open';

const STORAGE_KEY = 'am.fromApp';
let memoryFlag = false;

/** True only for exactly `from=app` in the query string. */
export const hasFromAppParam = (search: string): boolean =>
  new URLSearchParams(search).get(FROM_APP_PARAM) === FROM_APP_VALUE;

const stored = (): boolean => {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return memoryFlag;
  }
};

/** Remembers the flag for this tab when the URL carries it. Returns the flag. */
export const captureFromApp = (search: string): boolean => {
  if (!hasFromAppParam(search)) return stored();
  memoryFlag = true;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Storage blocked: memory only (lost on reload, the URL still carries it).
  }
  return true;
};

/** Did this visit start in the app? Reads the URL first, then this tab's memory. */
export const isFromApp = (search: string = typeof window !== 'undefined' ? window.location.search : ''): boolean =>
  hasFromAppParam(search) || stored();

export const clearFromApp = (): void => {
  memoryFlag = false;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored.
  }
};

/**
 * Adds `from=app` to a same-site path or URL when the flag is set, so it
 * survives an email link or a trip through the identity check.
 */
export const withFromApp = (pathOrUrl: string, flagged: boolean = isFromApp()): string => {
  if (!flagged) return pathOrUrl;
  const [beforeHash, hash] = pathOrUrl.split('#', 2);
  const sep = beforeHash.includes('?') ? '&' : '?';
  return `${beforeHash}${sep}${FROM_APP_PARAM}=${FROM_APP_VALUE}${hash !== undefined ? `#${hash}` : ''}`;
};

/**
 * Where `/app/open` is served from. iPhone (and some Android browsers) only
 * open the app from a universal / App Link that points to a DIFFERENT domain
 * from the page it is tapped on, so the staging site links to the public site's
 * `/app/open` (both domains are linked to the app). Override with
 * `VITE_APP_OPEN_ORIGIN` (https origin only); anything else falls back.
 */
export const DEFAULT_APP_OPEN_ORIGIN = 'https://authentic-materials.com';

export const appOpenOrigin = (value: string | undefined = import.meta.env.VITE_APP_OPEN_ORIGIN): string => {
  if (!value) return DEFAULT_APP_OPEN_ORIGIN;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== value.replace(/\/$/, '')) return DEFAULT_APP_OPEN_ORIGIN;
    return url.origin;
  } catch {
    return DEFAULT_APP_OPEN_ORIGIN;
  }
};

const EMAIL_RE = /^[^\s@?&#/]+@[^\s@?&#/]+\.[^\s@?&#/]+$/;

/**
 * The only link back into the app: `<app-open origin>/app/open`, optionally
 * with the person's own email. The origin comes from build config, never from
 * the URL.
 */
export const appOpenHref = (email?: string | null, origin: string = appOpenOrigin()): string => {
  const e = email?.trim();
  if (e && e.length <= 254 && EMAIL_RE.test(e)) {
    return `${origin}${APP_OPEN_PATH}?${new URLSearchParams({ email: e }).toString()}`;
  }
  return `${origin}${APP_OPEN_PATH}`;
};
