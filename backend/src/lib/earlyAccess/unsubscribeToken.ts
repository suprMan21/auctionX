import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Unsubscribe links: `<signup id>.<HMAC>` so a link works forever without storing a
 * token, cannot be forged, and cannot be turned into another person's link.
 *
 * Key: App Runner env EARLY_ACCESS_UNSUBSCRIBE_SECRET (32+ random bytes, 1Password
 * `AM_Development/Early access/unsubscribe-secret`). Rotating it breaks old links, so don't.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const secret = (): string | null => {
  const s = process.env.EARLY_ACCESS_UNSUBSCRIBE_SECRET?.trim();
  return s && s.length >= 32 ? s : null;
};

export const isUnsubscribeConfigured = (): boolean => secret() !== null;

const mac = (key: string, id: string): Buffer => createHmac('sha256', key).update(`unsubscribe:v1:${id}`).digest();

/** Token for a signup id, or null when the secret is not configured. */
export const makeUnsubscribeToken = (id: string): string | null => {
  const key = secret();
  if (!key || !UUID.test(id)) return null;
  return `${id}.${mac(key, id).toString('base64url')}`;
};

/** The signup id a token belongs to, or null if it is malformed or forged. */
export const readUnsubscribeToken = (token: unknown): string | null => {
  const key = secret();
  if (!key || typeof token !== 'string' || token.length > 200) return null;
  const dot = token.indexOf('.');
  const id = token.slice(0, dot);
  if (dot < 0 || !UUID.test(id)) return null;
  const given = Buffer.from(token.slice(dot + 1), 'base64url');
  const expected = mac(key, id);
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
};
