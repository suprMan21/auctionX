import { describe, it, expect, afterEach } from 'vitest';
import { webAuthnConfig } from '../lib/mfa/config';

/** S-2FA Ph3a: WEBAUTHN_ORIGINS defaults to the RP ID; environments never share an origin (S-2FAb AC8). */

const saved = { id: process.env.WEBAUTHN_RP_ID, origins: process.env.WEBAUTHN_ORIGINS };
afterEach(() => {
  process.env.WEBAUTHN_RP_ID = saved.id;
  process.env.WEBAUTHN_ORIGINS = saved.origins;
  if (saved.id === undefined) delete process.env.WEBAUTHN_RP_ID;
  if (saved.origins === undefined) delete process.env.WEBAUTHN_ORIGINS;
});

describe('webAuthnConfig', () => {
  it('unset WEBAUTHN_ORIGINS allows only https://<rp id>', () => {
    process.env.WEBAUTHN_RP_ID = 'd1bwev65w7rqzl.cloudfront.net';
    delete process.env.WEBAUTHN_ORIGINS;
    expect(webAuthnConfig().origins).toEqual(['https://d1bwev65w7rqzl.cloudfront.net']);
  });

  it('a set list is used as given', () => {
    process.env.WEBAUTHN_RP_ID = 'authentic-materials.com';
    process.env.WEBAUTHN_ORIGINS = 'https://authentic-materials.com, https://app.authentic-materials.com';
    expect(webAuthnConfig().origins).toEqual(['https://authentic-materials.com', 'https://app.authentic-materials.com']);
  });

  it('staging never allows the production origin, and production never allows staging', () => {
    delete process.env.WEBAUTHN_ORIGINS;
    process.env.WEBAUTHN_RP_ID = 'd1bwev65w7rqzl.cloudfront.net';
    expect(webAuthnConfig().origins).not.toContain('https://authentic-materials.com');
    process.env.WEBAUTHN_RP_ID = 'authentic-materials.com';
    expect(webAuthnConfig().origins).not.toContain('https://d1bwev65w7rqzl.cloudfront.net');
  });

  it('WEBAUTHN_RP_ID stays required', () => {
    delete process.env.WEBAUTHN_RP_ID;
    expect(() => webAuthnConfig()).toThrow();
  });
});
