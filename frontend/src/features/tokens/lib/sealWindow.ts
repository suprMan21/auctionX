/**
 * DR-22 seal states on the tap page (S-SEAL1 Ph1, gate G3).
 *
 * Verified lasts about 90 s after a tap the server accepted, and only on the page
 * load that made the tap: a refresh, a sign-in round trip or a remembered tap shows
 * the still Sealed seal. The window is timed on this phone from the moment the
 * server's answer arrived, so a wrong device clock cannot stretch or shorten it.
 * When it ends the page asks for a new tap; nothing re-checks on its own.
 */

import { useEffect, useState } from 'react';

export const VERIFIED_WINDOW_MS = 90_000;

/** The tap this page load made: which seal page it was for and when the answer arrived (local ms). */
export interface FreshTap {
  readonly tokenName: string;
  readonly at: number;
}

export type SealState = 'verified' | 'sealed';

export const sealStateFor = (fresh: FreshTap | null, tokenName: string, now: number): SealState =>
  fresh !== null && fresh.tokenName === tokenName && now - fresh.at < VERIFIED_WINDOW_MS
    ? 'verified'
    : 'sealed';

export const secondsSince = (at: number, now: number): number => Math.max(0, Math.floor((now - at) / 1000));

/** Lifecycle states that still show a seal. On hold, released and retired show text only (Boss, 2026-10-28). */
export const showsSeal = (lifecycleStatus: string | null | undefined): boolean =>
  lifecycleStatus === 'ENROLLED' || lifecycleStatus === 'ACTIVE';

/**
 * The Verified clock for one seal page: ticks every second while this page's own tap is
 * inside the window, and stops for good on the tick that ends it (the seal then stays still).
 */
export const useSealClock = (fresh: FreshTap | null, tokenName: string): { now: number; state: SealState } => {
  const [now, setNow] = useState(() => Date.now());
  const state = sealStateFor(fresh, tokenName, now);
  const ticking = state === 'verified';
  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ticking]);
  return { now, state };
};
