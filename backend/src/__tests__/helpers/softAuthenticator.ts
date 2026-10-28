/**
 * A software passkey for tests: a real P-256 key that produces real WebAuthn
 * registration and assertion responses, so tests exercise @simplewebauthn's
 * actual checks (origin, RP ID, challenge, signature, user verification,
 * counter) rather than a mock of them.
 */

import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from 'crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

const b64u = (b: Buffer | Uint8Array): string => Buffer.from(b).toString('base64url');
const sha256 = (b: Buffer | string): Buffer => createHash('sha256').update(b).digest();

export interface SoftPasskeyOptions {
  rpId: string;
  origin: string;
  /** Synced passkey (iCloud / Google): sets the backup-eligible and backed-up flags. */
  synced?: boolean;
  /**
   * Packed full attestation (a hardware key proving its maker): the leaf's
   * private key (PEM), the chain leaf-first (PEM), and the 16-byte model ID.
   */
  attestation?: { leafKeyPem: string; chainPem: string[]; aaguid: Buffer };
}

const pemToDer = (pem: string): Buffer =>
  Buffer.from(pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, ''), 'base64');

export class SoftPasskey {
  readonly credentialId = randomBytes(32);
  private readonly privateKey: KeyObject;
  private readonly publicJwk: { x: string; y: string };
  counter = 0;
  /** Flip off to simulate an authenticator that skipped user verification. */
  userVerified = true;

  constructor(private readonly opts: SoftPasskeyOptions) {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = pair.privateKey;
    this.publicJwk = pair.publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  }

  get id(): string {
    return b64u(this.credentialId);
  }

  private flags(attested: boolean): number {
    let f = 0x01; // user present
    if (this.userVerified) f |= 0x04;
    if (this.opts.synced) f |= 0x08 | 0x10; // backup eligible + backed up
    if (attested) f |= 0x40;
    return f;
  }

  private coseKey(): Uint8Array {
    const map = new Map<number, number | Uint8Array>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, Buffer.from(this.publicJwk.x, 'base64url')],
      [-3, Buffer.from(this.publicJwk.y, 'base64url')],
    ]);
    return isoCBOR.encode(map as never);
  }

  private clientData(type: string, challenge: string, origin = this.opts.origin): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  register(challenge: string, overrides: { origin?: string; rpId?: string } = {}) {
    const rpIdHash = sha256(overrides.rpId ?? this.opts.rpId);
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.counter);
    const credLen = Buffer.alloc(2);
    credLen.writeUInt16BE(this.credentialId.length);
    const att = this.opts.attestation;
    const authData = Buffer.concat([
      rpIdHash, Buffer.from([this.flags(true)]), count, att ? att.aaguid : Buffer.alloc(16), credLen, this.credentialId, Buffer.from(this.coseKey()),
    ]);
    const clientDataJSON = this.clientData('webauthn.create', challenge, overrides.origin);
    let fmt = 'none';
    let attStmt = new Map<string, unknown>();
    if (att) {
      const signer = createSign('SHA256');
      signer.update(Buffer.concat([authData, sha256(clientDataJSON)]));
      fmt = 'packed';
      attStmt = new Map<string, unknown>([
        ['alg', -7],
        ['sig', signer.sign(att.leafKeyPem)],
        ['x5c', att.chainPem.map(pemToDer)],
      ]);
    }
    const attestationObject = isoCBOR.encode(new Map<string, unknown>([
      ['fmt', fmt], ['attStmt', attStmt], ['authData', authData],
    ]) as never);
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64u(clientDataJSON),
        attestationObject: b64u(attestationObject),
        transports: ['internal'],
      },
    };
  }

  assert(challenge: string, overrides: { origin?: string; rpId?: string; counter?: number } = {}) {
    this.counter = overrides.counter ?? this.counter + 1;
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.counter);
    const authData = Buffer.concat([sha256(overrides.rpId ?? this.opts.rpId), Buffer.from([this.flags(false)]), count]);
    const clientDataJSON = this.clientData('webauthn.get', challenge, overrides.origin);
    const signer = createSign('SHA256');
    signer.update(Buffer.concat([authData, sha256(clientDataJSON)]));
    const signature = signer.sign(this.privateKey); // DER, as authenticators produce
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64u(clientDataJSON),
        authenticatorData: b64u(authData),
        signature: b64u(signature),
      },
    };
  }
}
