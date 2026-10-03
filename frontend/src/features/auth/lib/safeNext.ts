/**
 * Validates a post-login return path from `?next=`.
 *
 * Only same-origin, absolute app paths are honoured. Anything else (another
 * origin, a protocol-relative `//evil.example`, a backslash trick, a
 * `javascript:` URL) falls back, so the login page can never be used as an
 * open redirect.
 */
export const safeNextPath = (raw: string | null | undefined, fallback: string): string => {
  if (!raw) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;
  try {
    const url = new URL(raw, 'https://app.invalid');
    if (url.origin !== 'https://app.invalid') return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
};

/** `/login?next=<current path>` for a page that needs a signed-in visitor. */
export const loginPathFor = (returnTo: string): string => `/login?next=${encodeURIComponent(returnTo)}`;
