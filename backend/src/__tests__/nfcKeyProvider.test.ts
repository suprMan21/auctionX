import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import type { GenerateMacCommand } from '@aws-sdk/client-kms';
import {
  createKmsTagKeyProvider,
  createLocalTagKeyProvider,
  type KmsMacClient,
} from '../services/nfc/keys/tagKeyProvider';
import { kdfInfo, kdfMessage, type TagKeyRequest } from '../services/nfc/keys/keyDerivation';
import { getTagKeyProvider, readNfcKeyConfig } from '../services/nfc/keys/config';
import { hex, loadSharedVectors, testAudit, toHex, type KdfVector } from './helpers/sdmVectors';
import { spyOnSecurityEvents, type SecurityEventSpy } from './helpers/securityEvents';

/**
 * S-NFC3.5 — chip-key providers against the shared OpenSSL KDF vectors.
 *
 * The KMS provider is exercised with a mock client that computes the HMAC the
 * way KMS would (the root lives only inside the mock). No network.
 */

const vectors = loadSharedVectors();
const ADMIN_ROLES = ['APP_MASTER', 'APP_KEY1', 'APP_KEY4'];
const sdmKdf = vectors.kdf.filter((v) => !ADMIN_ROLES.includes(v.role));
const adminKdf = vectors.kdf.filter((v) => ADMIN_ROLES.includes(v.role));

const requestFor = (v: KdfVector): TagKeyRequest =>
  v.role === 'META'
    ? { role: 'META', version: v.version }
    : {
        role: v.role as 'FILE',
        version: v.version,
        uid: hex(v.uid),
        ...(v.serial ? { serial: hex(v.serial) } : {}),
      };

class FakeKms implements KmsMacClient {
  readonly inputs: Array<{ KeyId?: string; MacAlgorithm?: string; Message?: Uint8Array }> = [];
  constructor(private readonly root: Buffer, private readonly mode: 'ok' | 'fail' | 'short' = 'ok') {}
  async send(command: GenerateMacCommand): Promise<{ Mac?: Uint8Array }> {
    this.inputs.push(command.input);
    if (this.mode === 'fail') throw new Error(`AccessDenied for ${command.input.KeyId}`);
    const mac = createHmac('sha256', this.root).update(command.input.Message as Uint8Array).digest();
    return { Mac: this.mode === 'short' ? mac.subarray(0, 16) : new Uint8Array(mac) };
  }
}

let events: SecurityEventSpy;
beforeEach(() => {
  events = spyOnSecurityEvents();
});
afterEach(() => events.restore());

describe('KDF message + info are the locked spec (shared vectors)', () => {
  it.each(sdmKdf.map((v) => [v.name, v] as const))('%s', (_n, v) => {
    expect(toHex(kdfMessage(requestFor(v)))).toBe(v.message);
    expect(toHex(kdfInfo(v.role as 'META' | 'FILE', v.version))).toBe(v.info);
  });
});

describe('local provider reproduces the OpenSSL KDF vectors', () => {
  it.each(sdmKdf.map((v) => [v.name, v] as const))('%s', async (_n, v) => {
    const p = createLocalTagKeyProvider({ sdmRootKeyHex: v.rootKey, allowLocalKeys: true });
    expect(toHex(await p.deriveKey(requestFor(v), testAudit))).toBe(v.key);
  });
});

describe('KMS provider reproduces the same vectors (KMS and local agree)', () => {
  it.each(sdmKdf.map((v) => [v.name, v] as const))('%s', async (_n, v) => {
    const kms = new FakeKms(hex(v.rootKey));
    const p = createKmsTagKeyProvider({ keyId: 'alias/am-tag-sdm-staging', region: 'us-east-2', client: kms });
    expect(toHex(await p.deriveKey(requestFor(v), testAudit))).toBe(v.key);
    expect(kms.inputs).toHaveLength(1);
    expect(kms.inputs[0].KeyId).toBe('alias/am-tag-sdm-staging');
    expect(kms.inputs[0].MacAlgorithm).toBe('HMAC_SHA_256');
    expect(toHex(Buffer.from(kms.inputs[0].Message as Uint8Array))).toBe(v.message);
  });

  it('does not cache: two derivations are two GenerateMac calls', async () => {
    const kms = new FakeKms(hex(sdmKdf[0].rootKey));
    const p = createKmsTagKeyProvider({ keyId: 'k', region: 'us-east-2', client: kms });
    await p.deriveKey({ role: 'META', version: 1 }, testAudit);
    await p.deriveKey({ role: 'META', version: 1 }, testAudit);
    expect(kms.inputs).toHaveLength(2);
  });

  it('emits kms.op GenerateMac / tag_key with no UID and no key material', async () => {
    const v = sdmKdf.find((x) => x.role === 'FILE')!;
    const p = createKmsTagKeyProvider({ keyId: 'k', region: 'us-east-2', client: new FakeKms(hex(v.rootKey)) });
    const key = await p.deriveKey(requestFor(v), { ...testAudit, tagId: '55555555-5555-4555-8555-555555555555' });

    const ops = events.named('kms.op');
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      operation: 'GenerateMac',
      purpose: 'tag_key',
      result: 'ok',
      tag_id: '55555555-5555-4555-8555-555555555555',
    });
    const blob = events.blob().toUpperCase();
    expect(blob).not.toContain(toHex(key));
    expect(blob).not.toContain(v.uid);
    expect(blob).not.toContain(v.rootKey);
    expect(blob).not.toContain(v.prk);
  });

  it('fails closed with a generic error (no KMS text) and emits result internal', async () => {
    const p = createKmsTagKeyProvider({ keyId: 'alias/secret-name', region: 'us-east-2', client: new FakeKms(Buffer.alloc(32), 'fail') });
    await expect(p.deriveKey({ role: 'META', version: 1 }, testAudit)).rejects.toThrow(/^Tag key derivation failed$/);
    expect(events.named('kms.op')[0]).toMatchObject({ operation: 'GenerateMac', result: 'internal' });
  });

  it('rejects a MAC of the wrong length', async () => {
    const p = createKmsTagKeyProvider({ keyId: 'k', region: 'us-east-2', client: new FakeKms(Buffer.alloc(32), 'short') });
    await expect(p.deriveKey({ role: 'META', version: 1 }, testAudit)).rejects.toThrow();
  });
});

describe('the backend can never derive an application master key (amended 2026-10-01)', () => {
  it.each(adminKdf.map((v) => [v.name, v] as const))('local provider refuses %s', async (_n, v) => {
    const p = createLocalTagKeyProvider({ sdmRootKeyHex: v.rootKey, allowLocalKeys: true });
    const req = { role: v.role, version: v.version, uid: hex(v.uid), serial: hex(v.serial) } as unknown as TagKeyRequest;
    await expect(p.deriveKey(req, testAudit)).rejects.toThrow(/not permitted/);
  });

  it('KMS provider refuses before any KMS call', async () => {
    const kms = new FakeKms(Buffer.alloc(32));
    const p = createKmsTagKeyProvider({ keyId: 'k', region: 'us-east-2', client: kms });
    const req = { role: 'APP_MASTER', version: 1, uid: hex('04A27E02936980') } as unknown as TagKeyRequest;
    await expect(p.deriveKey(req, testAudit)).rejects.toThrow(/not permitted/);
    expect(kms.inputs).toHaveLength(0);
  });
});

describe('request validation', () => {
  const p = () => createLocalTagKeyProvider({ sdmRootKeyHex: '00'.repeat(32), allowLocalKeys: true });
  it('META takes no UID; FILE needs exactly 7 bytes; version is 1..255', async () => {
    await expect(p().deriveKey({ role: 'META', version: 1, uid: hex('04A27E02936980') }, testAudit)).rejects.toThrow();
    await expect(p().deriveKey({ role: 'FILE', version: 1 }, testAudit)).rejects.toThrow();
    await expect(p().deriveKey({ role: 'FILE', version: 1, uid: hex('04A27E') }, testAudit)).rejects.toThrow();
    await expect(p().deriveKey({ role: 'META', version: 0 }, testAudit)).rejects.toThrow();
    await expect(p().deriveKey({ role: 'META', version: 256 }, testAudit)).rejects.toThrow();
  });

  it('different UIDs, versions and serials give different FILE keys', async () => {
    const uid = hex('04A27E02936980');
    const a = await p().deriveKey({ role: 'FILE', version: 1, uid }, testAudit);
    const b = await p().deriveKey({ role: 'FILE', version: 1, uid: hex('04DE5F1EACC040') }, testAudit);
    const c = await p().deriveKey({ role: 'FILE', version: 2, uid, serial: hex('5A1E7C0D93B2468F') }, testAudit);
    // S-NFC-ID: same UID, other chip -> other key
    const d = await p().deriveKey({ role: 'FILE', version: 2, uid, serial: hex('C3D24B19E0F7A651') }, testAudit);
    expect(new Set([toHex(a), toHex(b), toHex(c), toHex(d)]).size).toBe(4);
  });

  it('S-NFC-ID: v2 FILE needs an 8-byte serial; v1 and META take none', async () => {
    const uid = hex('04A27E02936980');
    await expect(p().deriveKey({ role: 'FILE', version: 2, uid }, testAudit)).rejects.toThrow(/serial/);
    await expect(p().deriveKey({ role: 'FILE', version: 2, uid, serial: hex('0102') }, testAudit)).rejects.toThrow();
    await expect(p().deriveKey({ role: 'FILE', version: 1, uid, serial: hex('5A1E7C0D93B2468F') }, testAudit)).rejects.toThrow();
    await expect(p().deriveKey({ role: 'META', version: 2, serial: hex('5A1E7C0D93B2468F') }, testAudit)).rejects.toThrow();
  });
});

describe('configuration (Zod)', () => {
  const root = '0F'.repeat(32);

  it('defaults to KMS on the staging SDM root alias', async () => {
    const cfg = readNfcKeyConfig({});
    expect(cfg.NFC_KEY_PROVIDER).toBe('kms');
    expect(cfg.NFC_KMS_SDM_KEY_ID).toBe('alias/am-tag-sdm-staging');
    expect(cfg.NFC_ALLOW_LOCAL_KEYS).toBe(false);
    expect(cfg.NFC_SDM_KEY_VERSION).toBe(1);

    const kms = new FakeKms(Buffer.alloc(32));
    await getTagKeyProvider({}, kms).deriveKey({ role: 'META', version: 1 }, testAudit);
    expect(kms.inputs[0].KeyId).toBe('alias/am-tag-sdm-staging');
  });

  it('local provider refuses to construct unless NFC_ALLOW_LOCAL_KEYS=true', () => {
    expect(() => getTagKeyProvider({ NFC_KEY_PROVIDER: 'local', NFC_LOCAL_SDM_ROOT_KEY: root })).toThrow(
      /NFC_ALLOW_LOCAL_KEYS/,
    );
    expect(() =>
      getTagKeyProvider({ NFC_KEY_PROVIDER: 'local', NFC_LOCAL_SDM_ROOT_KEY: root, NFC_ALLOW_LOCAL_KEYS: 'false' }),
    ).toThrow();
    expect(
      getTagKeyProvider({ NFC_KEY_PROVIDER: 'local', NFC_LOCAL_SDM_ROOT_KEY: root, NFC_ALLOW_LOCAL_KEYS: 'true' }).name,
    ).toBe('local');
  });

  it('rejects a malformed root without echoing it', () => {
    const bad = 'Z'.repeat(64);
    let message = '';
    try {
      readNfcKeyConfig({ NFC_LOCAL_SDM_ROOT_KEY: bad });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/NFC_LOCAL_SDM_ROOT_KEY/);
    expect(message).not.toContain(bad);
  });

  it('local provider without a root fails closed', () => {
    expect(() => getTagKeyProvider({ NFC_KEY_PROVIDER: 'local', NFC_ALLOW_LOCAL_KEYS: 'true' })).toThrow();
  });
});
