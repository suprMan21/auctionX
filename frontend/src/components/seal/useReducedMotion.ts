import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

const media = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;

const subscribe = (onChange: () => void) => {
  const m = media();
  m?.addEventListener?.('change', onChange);
  return () => m?.removeEventListener?.('change', onChange);
};

/** True when the viewer asked for less motion. Used to leave moving parts out of the DOM altogether. */
export const useReducedMotion = (): boolean =>
  useSyncExternalStore(subscribe, () => media()?.matches ?? false, () => false);
