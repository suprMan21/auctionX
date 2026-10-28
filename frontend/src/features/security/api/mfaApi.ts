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
  | 'admin_approve'
  /** Password or email change (target 'password' / 'email'). */
  | 'account_change'
  /** Ph3b: undo a recent account recovery (target = recovery id). */
  | 'recovery_undo'
  /** Ph3b: add or remove the backup email (target 'backup_email'). */
  | 'recovery_channel';

/** Header the backend binds emailed codes to (with the session). */
export const RECOVERY_NONCE_HEADER = 'X-Recovery-Nonce';

const NONCE_KEY = 'am.recoveryNonce';
let memoryNonce: string | null = null;

/**
 * A random per-browser value sent with every recovery request. An emailed code
 * only works together with it, so a code read from the inbox is useless in
 * another browser. Kept in localStorage (falls back to memory when storage is
 * blocked: then a reload means asking for a new code).
 */
export const recoveryNonce = (): string => {
  try {
    const stored = window.localStorage.getItem(NONCE_KEY);
    if (stored && /^[A-Za-z0-9_-]{43}$/.test(stored)) return stored;
  } catch {
    // Storage blocked: use memory.
  }
  if (!memoryNonce) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    memoryNonce = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  try {
    window.localStorage.setItem(NONCE_KEY, memoryNonce);
  } catch {
    // Memory only.
  }
  return memoryNonce;
};

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
  /** Added by an account recovery: cannot confirm Undo. */
  fromRecovery: z.boolean().optional().default(false),
});

const recoveryStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['holding', 'completed']),
  holdEndsAt: z.string().nullable(),
  freezeEndsAt: z.string().nullable(),
  mustAddMethod: z.boolean(),
  addMethodBefore: z.string().nullable(),
  canUndo: z.boolean(),
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
  // Ph3b; older backends leave them out.
  backupEmail: z.object({ masked: z.string(), verified: z.boolean(), pendingMasked: z.string().optional() }).nullable().optional().default(null),
  recovery: recoveryStatusSchema.nullable().optional().default(null),
});

export type RecoveryStatus = z.infer<typeof recoveryStatusSchema>;

const channelSchema = z.enum(['primary', 'backup']);
export type RecoveryChannel = z.infer<typeof channelSchema>;

const recoveryOverviewSchema = z.object({
  available: z.boolean(),
  notAvailableReason: z.enum(['staff', 'no_method', 'verified', 'frozen', 'no_email']).nullable(),
  channels: z.array(z.object({ channel: channelSchema, sentTo: z.string() })),
  recovery: z.object({ status: z.literal('holding'), holdEndsAt: z.string(), ready: z.boolean(), channel: channelSchema }).nullable(),
});
export type RecoveryOverview = z.infer<typeof recoveryOverviewSchema>;

const codeSentSchema = z.object({
  codeId: z.string().uuid(),
  purpose: z.enum(['recovery_start', 'recovery_finish', 'backup_email_verify']),
  sentTo: z.string(),
  expiresAt: z.string(),
  resendAfter: z.string().nullable(),
});
export type CodeSent = z.infer<typeof codeSentSchema>;

const recoveryStartedSchema = z.object({ status: z.literal('holding'), holdEndsAt: z.string(), channel: channelSchema });
const recoveryFinishedSchema = z.object({
  status: z.literal('completed'),
  freezeEndsAt: z.string(),
  addMethodBefore: z.string(),
  passwordPermitExpiresAt: z.string().nullable(),
});
const cancelledSchema = z.object({ cancelled: z.string() });
const undoneSchema = z.object({ undone: z.string(), backupCodes: z.array(z.string()).nullable(), otherSessionsEnded: z.boolean() });
const backupVerifiedSchema = z.object({ backupEmail: z.object({ masked: z.string(), verified: z.literal(true) }) });
const backupRemovedSchema = z.object({ removed: z.literal(true) });

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

const permitSchema = z.object({ kind: z.enum(['password', 'email']), expiresAt: z.string() });

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
  init: { method?: string; body?: unknown; stepUpToken?: string; nonce?: boolean } = {},
): Promise<T> => {
  const headers: Record<string, string> = {
    ...(await authHeader()),
    ...(init.nonce ? { [RECOVERY_NONCE_HEADER]: recoveryNonce() } : {}),
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

  /** A one-time, 2-minute permit the database checks before a password or email change. */
  accountChangePermit: (kind: 'password' | 'email', stepUpToken: string) =>
    request('/account-change', permitSchema, { method: 'POST', body: { kind }, stepUpToken }),

  regenerateBackupCodes: (stepUpToken: string) =>
    request('/recovery-codes/regenerate', codesSchema, { method: 'POST', body: {}, stepUpToken }),

  // ── Ph3b: email-code recovery + backup email ──
  recoveryOverview: () => request('/recovery', recoveryOverviewSchema, { nonce: true }),

  /** Starts with `channel`; once the wait is over, `{}` sends the code that finishes it. */
  sendRecoveryCode: (channel?: RecoveryChannel) =>
    request('/recovery/code', codeSentSchema, { method: 'POST', body: channel ? { channel } : {}, nonce: true }),

  startRecovery: (codeId: string, code: string) =>
    request('/recovery/start', recoveryStartedSchema, { method: 'POST', body: { codeId, code }, nonce: true }),

  finishRecovery: (codeId: string, code: string, setPassword: boolean) =>
    request('/recovery/finish', recoveryFinishedSchema, { method: 'POST', body: { codeId, code, setPassword }, nonce: true }),

  cancelRecovery: () => request('/recovery/cancel', cancelledSchema, { method: 'POST', body: {} }),

  undoRecovery: (recoveryId: string, stepUpToken: string) =>
    request('/recovery/undo', undoneSchema, { method: 'POST', body: { recoveryId }, stepUpToken }),

  addBackupEmail: (email: string, stepUpToken: string) =>
    request('/backup-email', codeSentSchema, { method: 'POST', body: { email }, stepUpToken, nonce: true }),

  verifyBackupEmail: (codeId: string, code: string) =>
    request('/backup-email/verify', backupVerifiedSchema, { method: 'POST', body: { codeId, code }, nonce: true }),

  removeBackupEmail: (stepUpToken: string) =>
    request('/backup-email', backupRemovedSchema, { method: 'DELETE', stepUpToken }),
};
