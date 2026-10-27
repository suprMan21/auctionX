/**
 * S-2FA client for /api/v1/auth/mfa (Ph2 screens).
 *
 * Same envelope handling as tokenApi: the server's closed-set `reason` is kept
 * so screens branch on a code, never on error text. Every response is checked
 * with Zod. Passkey options are passed to the browser untouched; the server
 * already decided every field.
 */

import { z } from 'zod';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { supabase } from '@/lib/supabase';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';
const BASE = `${API_URL}/auth/mfa`;

/** Header the backend reads a step-up grant from. */
export const STEP_UP_HEADER = 'X-Step-Up';

/** Actions a step-up grant can be issued for (backend StepUpAction). */
export type StepUpAction =
  | 'release'
  | 'transfer_complete'
  | 'price_change'
  | 'factor_remove'
  | 'factor_add'
  | 'recovery_regen'
  | 'admin_action'
  | 'admin_approve';

export class MfaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly reason: string | null,
  ) {
    super(message);
    this.name = 'MfaApiError';
  }
}

const envelopeSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().nullable().optional(),
  code: z.string().optional(),
  reason: z.string().optional(),
  details: z.object({ reason: z.string().optional() }).passthrough().optional(),
});

const passkeySchema = z.object({
  id: z.string(),
  nickname: z.string(),
  synced: z.boolean(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable().optional(),
  /** Set while a passkey added with a code waits 24 h before it can confirm anything. */
  usableFrom: z.string().nullable().optional().default(null),
});

export const mfaStatusSchema = z.object({
  passkeys: z.array(passkeySchema),
  authenticatorApp: z.boolean(),
  authenticatorAppUsableFrom: z.string().nullable().optional().default(null),
  backupCodesLeft: z.number().int(),
  hasFactor: z.boolean(),
  sessionVerified: z.boolean(),
  enrolmentRequired: z.boolean(),
  // Added in Ph2; older backends leave them out.
  secondFactorRequired: z.boolean().optional().default(false),
  breakGlass: z.boolean(),
  isStaff: z.boolean().optional().default(false),
  codeEntryLockedUntil: z.string().nullable(),
});

export type MfaStatus = z.infer<typeof mfaStatusSchema>;
export type Passkey = z.infer<typeof passkeySchema>;

const optionsSchema = <T>() =>
  z.object({ challengeId: z.string().uuid(), options: z.record(z.unknown()) }).transform((v) => ({
    challengeId: v.challengeId,
    options: v.options as unknown as T,
  }));

const registerOptionsSchema = optionsSchema<PublicKeyCredentialCreationOptionsJSON>();
const assertionOptionsSchema = optionsSchema<PublicKeyCredentialRequestOptionsJSON>();

/** Every change to sign-in methods signs out the account's other devices. */
const ended = { otherSessionsEnded: z.boolean().optional() };

const registerResultSchema = z.object({
  passkey: passkeySchema.omit({ lastUsedAt: true, usableFrom: true }).extend({ usableFrom: z.string().nullable().optional() }),
  backupCodes: z.array(z.string()).nullable(),
  ...ended,
});

const signInResultSchema = z.object({
  method: z.enum(['passkey', 'totp', 'recovery_code']),
  backupCodesLeft: z.number().int().nullable(),
});

const grantSchema = z.object({
  stepUpToken: z.string().min(1),
  expiresAt: z.string(),
  action: z.string(),
  targetId: z.string(),
});

const totpSetupSchema = z.object({ secret: z.string(), otpauthUri: z.string().startsWith('otpauth://') });
const totpConfirmSchema = z.object({ authenticatorApp: z.literal(true), backupCodes: z.array(z.string()).nullable(), ...ended });
const codesSchema = z.object({ backupCodes: z.array(z.string()), ...ended });
const renameSchema = z.object({ id: z.string(), nickname: z.string() });
const removedSchema = z.object({ removed: z.string(), ...ended });

export type StepUpGrant = z.infer<typeof grantSchema>;

const authHeader = async (): Promise<Record<string, string>> => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new MfaApiError('Please sign in to continue.', 401, 'unauthenticated', null);
  return { Authorization: `Bearer ${token}` };
};

const request = async <T>(
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  init: { method?: string; body?: unknown; stepUpToken?: string } = {},
): Promise<T> => {
  const headers: Record<string, string> = {
    ...(await authHeader()),
    ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(init.stepUpToken ? { [STEP_UP_HEADER]: init.stepUpToken } : {}),
  };
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new MfaApiError('We could not reach Authentic Materials. Check your connection and try again.', 0, 'network', null);
  }
  const json: unknown = await res.json().catch(() => null);
  const envelope = envelopeSchema.safeParse(json);
  if (!res.ok || !envelope.success || !envelope.data.success) {
    const body = envelope.success ? envelope.data : null;
    throw new MfaApiError(
      body?.error ?? 'Something went wrong. Please try again.',
      res.status,
      body?.code ?? null,
      body?.reason ?? body?.details?.reason ?? null,
    );
  }
  const parsed = schema.safeParse(envelope.data.data);
  if (!parsed.success) throw new MfaApiError('Unexpected response from the server.', res.status, 'bad_response', null);
  return parsed.data;
};

export type SecondFactorInput =
  | { passkey: { challengeId: string; response: AuthenticationResponseJSON } }
  | { totp: { code: string } }
  | { recoveryCode: { code: string } };

export const mfaApi = {
  status: () => request('/status', mfaStatusSchema),

  passkeyRegisterOptions: (stepUpToken?: string) =>
    request('/passkeys/register/options', registerOptionsSchema, { method: 'POST', body: {}, stepUpToken }),

  passkeyRegisterVerify: (input: { challengeId: string; nickname: string; response: RegistrationResponseJSON }) =>
    request('/passkeys/register/verify', registerResultSchema, { method: 'POST', body: input }),

  renamePasskey: (id: string, nickname: string) =>
    request(`/passkeys/${encodeURIComponent(id)}`, renameSchema, { method: 'PATCH', body: { nickname } }),

  removePasskey: (id: string, stepUpToken: string) =>
    request(`/passkeys/${encodeURIComponent(id)}`, removedSchema, { method: 'DELETE', stepUpToken }),

  signInOptions: () => request('/sign-in/options', assertionOptionsSchema, { method: 'POST', body: {} }),

  signInVerify: (input: SecondFactorInput) =>
    request('/sign-in/verify', signInResultSchema, { method: 'POST', body: input }),

  stepUpOptions: (action: StepUpAction, targetId: string) =>
    request('/step-up/options', assertionOptionsSchema, { method: 'POST', body: { action, targetId } }),

  stepUpVerifyPasskey: (challengeId: string, response: AuthenticationResponseJSON) =>
    request('/step-up/verify', grantSchema, { method: 'POST', body: { challengeId, response } }),

  stepUpVerifyCode: (action: StepUpAction, targetId: string, code: { totp: string } | { recoveryCode: string }) =>
    request('/step-up/verify', grantSchema, {
      method: 'POST',
      body: 'totp' in code
        ? { action, targetId, totp: { code: code.totp } }
        : { action, targetId, recoveryCode: { code: code.recoveryCode } },
    }),

  totpSetup: (stepUpToken?: string) => request('/totp/setup', totpSetupSchema, { method: 'POST', body: {}, stepUpToken }),

  totpConfirm: (code: string) => request('/totp/confirm', totpConfirmSchema, { method: 'POST', body: { code } }),

  removeTotp: (stepUpToken: string) => request('/totp', removedSchema, { method: 'DELETE', stepUpToken }),

  regenerateBackupCodes: (stepUpToken: string) =>
    request('/recovery-codes/regenerate', codesSchema, { method: 'POST', body: {}, stepUpToken }),
};
