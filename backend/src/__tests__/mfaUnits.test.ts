import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'crypto';
import { base32Encode, hotp, matchTotp, totpStep } from '../lib/mfa/totp';
import { generateRecoveryCodes, hashRecoveryCode, normaliseRecoveryCode } from '../lib/mfa/recoveryCodes';
import { openSecret, sealSecret } from '../lib/mfa/secretBox';
import { readVerifiedClaims } from '../lib/mfa/jwtClaims';
import { mfaEmailContent } from '../lib/mfa/mfaEmails';

beforeEach(() => {
  process.env.MFA_SECRET_KEY = randomBytes(32).toString('base64');
  process.env.MFA_RECOVERY_PEPPER = 'pepper';
});

describe('TOTP (RFC 6238 appendix B, SHA-1, 8 digits)', () => {
  const secret = Buffer.from('12345678901234567890');
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('t=%i → %s', (t, expected) => {
    expect(hotp(secret, totpStep(t * 1000), 8)).toBe(expected);
  });

  it('accepts one step of drift either side, nothing further', () => {
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    expect(matchTotp(secret, hotp(secret, step - 1), now)).toBe(step - 1);
    expect(matchTotp(secret, hotp(secret, step + 1), now)).toBe(step + 1);
    expect(matchTotp(secret, hotp(secret, step - 2), now)).toBeNull();
    expect(matchTotp(secret, '12345', now)).toBeNull();
    expect(matchTotp(secret, 'abcdef', now)).toBeNull();
  });

  it('base32 matches RFC 4648', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });
});

describe('backup codes', () => {
  it('makes 10 distinct codes without look-alike characters', () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/);
    expect(codes.join('')).not.toMatch(/[01ILO]/);
  });

  it('normalises what people type and rejects what can never be a code', () => {
    expect(normaliseRecoveryCode('abcde fghjk')).toBe('ABCDE-FGHJK');
    expect(normaliseRecoveryCode(' ABCDE--FGHJK ')).toBe('ABCDE-FGHJK');
    expect(normaliseRecoveryCode('ABCDE-FGHJ')).toBeNull();
    expect(normaliseRecoveryCode('ABCDE-FGHJ0')).toBeNull();
  });

  it('hashes per account: the same code hashes differently for two users', () => {
    expect(hashRecoveryCode('u1', 'ABCDE-FGHJK')).not.toBe(hashRecoveryCode('u2', 'ABCDE-FGHJK'));
    expect(hashRecoveryCode('u1', 'ABCDE-FGHJK')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('secret envelope', () => {
  it('round-trips for the same account and fails for another', () => {
    const secret = randomBytes(20);
    const env = sealSecret(secret, 'user-a');
    expect(env.startsWith('v1.')).toBe(true);
    expect(openSecret(env, 'user-a').equals(secret)).toBe(true);
    expect(() => openSecret(env, 'user-b')).toThrow();
  });

  it('fails with another key', () => {
    const env = sealSecret(randomBytes(20), 'user-a');
    process.env.MFA_SECRET_KEY = randomBytes(32).toString('base64');
    expect(() => openSecret(env, 'user-a')).toThrow();
  });
});

describe('verified claims', () => {
  const token = (claims: object) => `Bearer h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
  it('reads a session id only when it is a uuid', () => {
    expect(readVerifiedClaims(token({ sub: 'x', session_id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' })).sessionId)
      .toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(readVerifiedClaims(token({ sub: 'x', session_id: "1' or 1=1" })).sessionId).toBeNull();
    expect(readVerifiedClaims('Bearer garbage').sessionId).toBeNull();
    expect(readVerifiedClaims(undefined)).toEqual({ sessionId: null, sub: null });
  });
});

describe('security email copy', () => {
  it('uses plain words and no em dashes', () => {
    const all = [
      mfaEmailContent({ kind: 'factor_added', method: 'passkey', nickname: 'Phone' }),
      mfaEmailContent({ kind: 'factor_removed', method: 'totp' }),
      mfaEmailContent({ kind: 'recovery_code_used', left: 2 }),
      mfaEmailContent({ kind: 'recovery_codes_new' }),
      mfaEmailContent({ kind: 'break_glass_sign_in', method: 'passkey' }),
    ];
    const text = JSON.stringify(all);
    expect(text).not.toMatch(/—|WebAuthn|AAL|TOTP|MFA/);
    expect(all[0].lines[0]).toMatch(/^A passkey \("Phone"\)/);
    expect(all[2].lines[1]).toMatch(/running low/);
  });
});
