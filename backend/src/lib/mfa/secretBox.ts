/**
 * Encrypts authenticator-app (TOTP) secrets at rest.
 *
 * Same envelope as the ownership salt (lib/ownership/ownershipProof.ts):
 * AES-256-GCM, stored as `v1.<iv>.<tag>.<ciphertext>` (base64). The user id is
 * the additional authenticated data, so a secret copied onto another account's
 * row fails to decrypt instead of working there. The version prefix lets a KMS
 * provider take over later without orphaning rows.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { mfaSecretKey } from './config';

const VERSION = 'v1';

export const sealSecret = (secret: Buffer, userId: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', mfaSecretKey(), iv);
  cipher.setAAD(Buffer.from(`am:totp:${userId}`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.');
};

export const openSecret = (envelope: string, userId: string): Buffer => {
  const [version, ivB64, tagB64, ctB64] = envelope.split('.');
  if (version !== VERSION || !ivB64 || !tagB64 || !ctB64) {
    throw new Error('Unrecognised secret envelope');
  }
  // Tag length pinned: a truncated tag must never be accepted.
  const decipher = createDecipheriv('aes-256-gcm', mfaSecretKey(), Buffer.from(ivB64, 'base64'), { authTagLength: 16 });
  decipher.setAAD(Buffer.from(`am:totp:${userId}`, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]);
};
