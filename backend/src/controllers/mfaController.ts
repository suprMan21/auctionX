/**
 * S-2FA HTTP layer: validates input (Zod, strict), builds the caller, calls
 * lib/mfa/mfaService.ts. No logic lives here.
 */

import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { AppError } from '../lib/errors';
import { isAdminTwoFactorRequired, isTwoFactorRequired } from '../lib/featureFlags';
import { callerFrom, STEP_UP_HEADER } from '../middleware/mfaGates';
import * as mfa from '../lib/mfa/mfaService';
import { getMfaStore } from '../lib/mfa/store';

const base64url = z.string().min(1).max(4096).regex(/^[A-Za-z0-9_-]+$/);

/** Shape only; @simplewebauthn checks every byte. Unknown top-level keys refused. */
const credentialBase = {
  id: base64url.max(1024),
  rawId: base64url.max(1024),
  type: z.literal('public-key'),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  // Native toJSON() and some password-manager extensions send null here.
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).nullish().transform((v) => v ?? undefined),
};

const registrationResponse = z.object({
  ...credentialBase,
  response: z.object({
    clientDataJSON: base64url,
    attestationObject: base64url,
    transports: z.array(z.string().max(32)).max(8).optional(),
    publicKey: base64url.optional(),
    publicKeyAlgorithm: z.number().int().optional(),
    authenticatorData: base64url.optional(),
  }).passthrough(),
}).strict();

const authenticationResponse = z.object({
  ...credentialBase,
  response: z.object({
    clientDataJSON: base64url,
    authenticatorData: base64url,
    signature: base64url,
    userHandle: base64url.nullish().transform((v) => v ?? undefined),
  }).passthrough(),
}).strict();

const uuid = z.string().uuid();
const nickname = z.string().trim().min(1).max(40).regex(/^[^<>\u0000-\u001f]+$/, 'Use letters, numbers and spaces');

const stepUpAction = z.enum([
  'release', 'transfer_complete', 'price_change', 'factor_remove', 'factor_add', 'recovery_regen', 'admin_action', 'admin_approve',
  'account_change',
]);
const targetId = z.string().min(1).max(200).regex(/^[A-Za-z0-9_:.-]+$/);
const totpCode = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).strict();
const backupCode = z.object({ code: z.string().max(32) }).strict();

const schemas = {
  registerVerify: z.object({ challengeId: uuid, nickname, response: registrationResponse }).strict(),
  signIn: z.union([
    z.object({ passkey: z.object({ challengeId: uuid, response: authenticationResponse }).strict() }).strict(),
    z.object({ totp: totpCode }).strict(),
    z.object({ recoveryCode: backupCode }).strict(),
  ]),
  stepUpOptions: z.object({ action: stepUpAction, targetId }).strict(),
  stepUpVerify: z.union([
    z.object({ challengeId: uuid, response: authenticationResponse }).strict(),
    z.object({ action: stepUpAction, targetId, totp: totpCode }).strict(),
    z.object({ action: stepUpAction, targetId, recoveryCode: backupCode }).strict(),
  ]),
  totpConfirm: z.object({ code: z.string().trim().regex(/^\d{6}$/) }).strict(),
  rename: z.object({ nickname }).strict(),
  accountChange: z.object({ kind: z.enum(['password', 'email']) }).strict(),
};

const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new AppError('invalid_argument', 'Validation failed');
  return parsed.data;
};

const caller = (req: Request): mfa.Caller => {
  const c = callerFrom(req as never);
  if (!c) throw new AppError('unauthenticated', 'Authentication required');
  return c;
};

const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ success: true, data, error: null });

export const getMfaStatus = async (req: Request, res: Response) => {
  const c = caller(req);
  const staff = isAdminTwoFactorRequired() ? Boolean(await getMfaStore().staffRole(c.userId)) : false;
  ok(res, await mfa.getStatus(c, isTwoFactorRequired() || staff));
};

const stepUpHeader = (req: Request): string | undefined => req.get(STEP_UP_HEADER) ?? undefined;

export const postRegisterOptions = async (req: Request, res: Response) => {
  ok(res, await mfa.passkeyRegisterOptions(caller(req), stepUpHeader(req)));
};

export const postRegisterVerify = async (req: Request, res: Response) => {
  const body = parse(schemas.registerVerify, req.body);
  ok(res, await mfa.passkeyRegisterVerify(caller(req), {
    challengeId: body.challengeId,
    nickname: body.nickname,
    response: body.response as unknown as RegistrationResponseJSON,
  }), 201);
};

export const postSignInOptions = async (req: Request, res: Response) => {
  ok(res, await mfa.signInOptions(caller(req)));
};

export const postSignInVerify = async (req: Request, res: Response) => {
  const body = parse(schemas.signIn, req.body);
  ok(res, await mfa.signInVerify(caller(req), body as unknown as mfa.SignInInput));
};

export const postStepUpOptions = async (req: Request, res: Response) => {
  ok(res, await mfa.stepUpOptions(caller(req), parse(schemas.stepUpOptions, req.body)));
};

export const postStepUpVerify = async (req: Request, res: Response) => {
  const body = parse(schemas.stepUpVerify, req.body);
  ok(res, await mfa.stepUpVerify(caller(req), body as unknown as mfa.StepUpVerifyInput));
};

export const postTotpSetup = async (req: Request, res: Response) => {
  ok(res, await mfa.totpSetup(caller(req), stepUpHeader(req)));
};

export const postTotpConfirm = async (req: Request, res: Response) => {
  ok(res, await mfa.totpConfirm(caller(req), parse(schemas.totpConfirm, req.body)));
};

export const postRegenerateCodes = async (req: Request, res: Response) => {
  ok(res, await mfa.regenerateRecoveryCodes(caller(req), stepUpHeader(req)));
};

export const patchPasskey = async (req: Request, res: Response) => {
  const id = parse(uuid, req.params.id);
  ok(res, await mfa.renamePasskey(caller(req), id, parse(schemas.rename, req.body).nickname));
};

export const deletePasskey = async (req: Request, res: Response) => {
  ok(res, await mfa.removePasskey(caller(req), parse(uuid, req.params.id)));
};

export const deleteTotp = async (req: Request, res: Response) => {
  ok(res, await mfa.removeTotp(caller(req)));
};

/**
 * Runs before the `account_change` step-up is spent (routes/mfa.ts): the body
 * must be valid and this session must already have passed its second factor,
 * so a refused request never burns the caller's step-up.
 */
export const preAccountChange = async (req: Request, _res: Response, next: NextFunction) => {
  parse(schemas.accountChange, req.body);
  await mfa.assertSecondFactorDone(caller(req));
  next();
};

export const postAccountChange = async (req: Request, res: Response) => {
  const { kind } = parse(schemas.accountChange, req.body);
  ok(res, await mfa.startAccountChange(caller(req), kind));
};
