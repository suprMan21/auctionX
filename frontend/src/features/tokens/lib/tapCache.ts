/**
 * Remembers the last verified tap per token name, for this browser tab only.
 *
 * A tap can be verified once. Without this, refreshing the verify page (or
 * coming back from sign-in to claim) would re-send a burned tap and show
 * "already used". sessionStorage is per-tab and cleared when the tab closes,
 * and every entry expires with its tap session (10 minutes) anyway.
 *
 * Storage can throw (private mode, blocked site data), so every access is
 * wrapped and the page works without it.
 */

import { tapResultSchema, type TapResult, type ValidTap } from '../api/schemas';

const PREFIX = 'am.tap.';
const MAX_AGE_MS = 10 * 60 * 1000;

interface Entry {
  readonly savedAt: number;
  readonly result: unknown;
}

export const saveTap = (tokenName: string, result: TapResult, now: number = Date.now()): void => {
  try {
    sessionStorage.setItem(PREFIX + tokenName, JSON.stringify({ savedAt: now, result } satisfies Entry));
  } catch {
    // Storage unavailable: a refresh will simply ask for a new tap.
  }
};

export const loadTap = (tokenName: string, now: number = Date.now()): TapResult | null => {
  try {
    const raw = sessionStorage.getItem(PREFIX + tokenName);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Partial<Entry>;
    if (typeof entry.savedAt !== 'number' || now - entry.savedAt > MAX_AGE_MS) {
      sessionStorage.removeItem(PREFIX + tokenName);
      return null;
    }
    const parsed = tapResultSchema.safeParse(entry.result);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/** Drops the tap session once it has been spent, keeping the verification. */
export const forgetTapSession = (tokenName: string): void => {
  const current = loadTap(tokenName);
  if (current && current.valid) saveTap(tokenName, { ...current, tapSession: null });
};

/** True while the tap's one-time session can still prove possession (10 minutes). */
export const isSessionLive = (tap: ValidTap, now: number = Date.now()): boolean =>
  Boolean(tap.tapSession && new Date(tap.tapSession.expiresAt).getTime() > now);
