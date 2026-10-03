/**
 * Token lifecycle API client (S-NFC3-FE).
 *
 * Unlike the legacy `lib/api.ts` (which throws `json.error` and drops the rest),
 * this keeps the server's closed-set `reason` code so screens branch on a code,
 * never on human error text. Every response is validated with Zod: a shape the
 * UI does not expect is an error, not an `undefined` read three components away.
 */

import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import {
  incomingTransfersSchema,
  myTokensSchema,
  ownershipLookupSchema,
  tapResultSchema,
  claimResultSchema,
  type ClaimResult,
  type IncomingTransfer,
  type MyToken,
  type OwnershipLookup,
  type TapResult,
} from './schemas';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

/** Machine-readable reasons the backend may attach (CLIENT_REASONS). */
export type TokenErrorReason =
  | 'replay_detected'
  | 'invalid_signature'
  | 'tap_session_invalid'
  | 'already_claimed'
  | 'token_released'
  | 'token_retired'
  | 'token_suspended'
  | 'transfer_pending'
  | '2fa_required';

export class TokenApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly reason: TokenErrorReason | null,
  ) {
    super(message);
    this.name = 'TokenApiError';
  }
}

const envelopeSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().nullable().optional(),
  code: z.string().optional(),
  reason: z.string().optional(),
});

const authHeader = async (required: boolean): Promise<Record<string, string>> => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    if (required) throw new TokenApiError('Please sign in to continue.', 401, 'unauthenticated', null);
    return {};
  }
  return { Authorization: `Bearer ${token}` };
};

const request = async <T>(
  path: string,
  schema: z.ZodType<T>,
  init: { method?: string; body?: unknown; auth: 'required' | 'optional' },
): Promise<T> => {
  const headers: Record<string, string> = {
    ...(await authHeader(init.auth === 'required')),
    ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
  };

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new TokenApiError('We could not reach Authentic Materials. Check your connection and try again.', 0, 'network', null);
  }

  const json: unknown = await res.json().catch(() => null);
  const envelope = envelopeSchema.safeParse(json);

  if (!res.ok || !envelope.success || !envelope.data.success) {
    const body = envelope.success ? envelope.data : null;
    throw new TokenApiError(
      body?.error ?? 'Something went wrong. Please try again.',
      res.status,
      body?.code ?? null,
      (body?.reason as TokenErrorReason | undefined) ?? null,
    );
  }

  const parsed = schema.safeParse(envelope.data.data);
  if (!parsed.success) {
    throw new TokenApiError('Unexpected response from the server.', res.status, 'bad_response', null);
  }
  return parsed.data;
};

/**
 * In-flight taps, keyed by the tapped URL. A tap can be verified exactly once
 * (the chip counter burns), so a duplicate request (React StrictMode runs
 * effects twice in dev; a fast double render does it in prod) must share the
 * first request instead of being rejected as a replay.
 */
const inFlightTaps = new Map<string, Promise<TapResult>>();

export const tokenApi = {
  tap(sunMessage: string): Promise<TapResult> {
    const existing = inFlightTaps.get(sunMessage);
    if (existing) return existing;
    const pending = request('/nfc/tap', tapResultSchema, {
      method: 'POST',
      body: { sunMessage },
      auth: 'optional',
    });
    inFlightTaps.set(sunMessage, pending);
    return pending;
  },

  claimWithTapSession(tapSession: string): Promise<ClaimResult> {
    return request('/nfc/claim', claimResultSchema, {
      method: 'POST',
      body: { tapSession },
      auth: 'required',
    });
  },

  async myTokens(): Promise<MyToken[]> {
    return (await request('/nfc/mine', myTokensSchema, { auth: 'required' })).tokens;
  },

  async incomingTransfers(): Promise<IncomingTransfer[]> {
    return (await request('/nfc/transfers/incoming', incomingTransfersSchema, { auth: 'required' })).transfers;
  },

  lookupOwnership(ownershipId: string): Promise<OwnershipLookup> {
    return request(`/ownership/${encodeURIComponent(ownershipId)}`, ownershipLookupSchema, { auth: 'optional' });
  },
};

/** Test seam: forget de-duplicated taps between tests. */
export const __resetInFlightTaps = (): void => inFlightTaps.clear();
