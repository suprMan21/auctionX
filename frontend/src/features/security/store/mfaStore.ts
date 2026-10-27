/**
 * The signed-in session's second-factor status, fetched once per Supabase
 * session and shared by the route guards, the sign-in page and Settings.
 * The server decides everything; this is a cache, never a gate on its own.
 */

import { create } from 'zustand';
import { mfaApi, type MfaStatus } from '../api/mfaApi';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

interface MfaState {
  /** Supabase session id the status belongs to. */
  sessionKey: string | null;
  status: MfaStatus | null;
  state: LoadState;
  /** Loads the status for this session unless it is already cached. */
  ensure: (sessionKey: string) => Promise<MfaStatus | null>;
  /** Re-fetches (after a sign-in step, an added or removed factor). */
  refresh: () => Promise<MfaStatus | null>;
  clear: () => void;
}

let inFlight: { key: string; promise: Promise<MfaStatus | null> } | null = null;

export const useMfaStore = create<MfaState>((set, get) => {
  const load = (key: string): Promise<MfaStatus | null> => {
    if (inFlight?.key === key) return inFlight.promise;
    set({ sessionKey: key, state: 'loading' });
    const promise = mfaApi
      .status()
      .then((status) => {
        if (get().sessionKey === key) set({ status, state: 'ready' });
        return status;
      })
      .catch(() => {
        if (get().sessionKey === key) set({ status: null, state: 'error' });
        return null;
      })
      .finally(() => {
        if (inFlight?.key === key) inFlight = null;
      });
    inFlight = { key, promise };
    return promise;
  };

  return {
    sessionKey: null,
    status: null,
    state: 'idle',
    ensure: async (key) => {
      const s = get();
      if (s.sessionKey === key && s.state === 'ready') return s.status;
      if (s.sessionKey !== key) set({ status: null });
      return load(key);
    },
    refresh: async () => {
      const key = get().sessionKey;
      if (!key) return null;
      inFlight = null;
      return load(key);
    },
    clear: () => {
      inFlight = null;
      set({ sessionKey: null, status: null, state: 'idle' });
    },
  };
});

/**
 * The `session_id` claim of a Supabase access token. A token refresh keeps the
 * same session, so the cached status survives it. Falls back to the user id
 * (still correct, just re-fetched less precisely) if the token is unreadable.
 */
export const sessionKeyOf = (accessToken: string | undefined, userId: string): string => {
  try {
    const payload = accessToken?.split('.')[1];
    if (!payload) return userId;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { session_id?: unknown };
    return typeof json.session_id === 'string' ? `${userId}:${json.session_id}` : userId;
  } catch {
    return userId;
  }
};
