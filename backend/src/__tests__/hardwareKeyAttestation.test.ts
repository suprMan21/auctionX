import { describe, it, expect, afterEach } from 'vitest';
import { X509Certificate } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import {
  YUBICO_FIDO_ROOTS,
  __setHardwareKeyRoots,
  checkHardwareKeyAttestation,
} from '../lib/mfa/hardwareKeyAttestation';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TEST_ROOT_PEM, otherVendor, testVendor } from './helpers/attestationFixtures';

/** S-2FA Ph4: the break-glass account's YubiKey check (chain part; signatures are @simplewebauthn's). */

const der = (pem: string) => new X509Certificate(pem).raw;
const MODEL = '11223344-5566-7788-99aa-bbccddeeff00';

const attObj = (fmt: string, x5c?: Buffer[]) =>
  new Uint8Array(isoCBOR.encode(new Map<string, unknown>([
    ['fmt', fmt],
    ['attStmt', new Map<string, unknown>(x5c ? [['alg', -7], ['sig', Buffer.alloc(8)], ['x5c', x5c]] : [['alg', -7], ['sig', Buffer.alloc(8)]])],
    ['authData', Buffer.alloc(37)],
  ]) as never));

afterEach(() => __setHardwareKeyRoots(null));

describe('pinned Yubico roots', () => {
  it('are the three FIDO roots Yubico publishes (by SHA-256 fingerprint)', () => {
    expect(YUBICO_FIDO_ROOTS.map((p) => new X509Certificate(p).fingerprint256)).toEqual([
      '0F:A1:38:6F:80:EB:87:13:26:3A:E5:C1:D8:4D:EB:45:5B:DF:08:AE:A5:0A:B0:55:03:CE:FE:E8:2B:09:2D:42',
      '35:F1:A5:4B:35:3B:FB:71:1E:6D:42:AD:BE:B7:6C:0E:9D:EA:D0:95:01:8E:6A:94:78:3B:A2:19:2F:D6:FA:AD',
      '62:76:0C:6A:6E:F9:16:79:F4:54:C8:90:2B:80:FD:00:98:25:B3:F2:5D:A9:0F:1F:BA:CE:2E:C6:58:6C:D5:A8',
    ]);
  });

  it('do not trust the test CA', () => {
    const chain = testVendor().chainPem.map(der);
    expect(checkHardwareKeyAttestation(attObj('packed', chain), MODEL)).toBe('unknown_vendor');
  });
});

describe('checkHardwareKeyAttestation', () => {
  const trustTest = () => __setHardwareKeyRoots([TEST_ROOT_PEM]);

  it('accepts a chain to a trusted root', () => {
    trustTest();
    expect(checkHardwareKeyAttestation(attObj('packed', testVendor().chainPem.map(der)), MODEL)).toBeNull();
  });

  it('accepts a chain that includes the root itself', () => {
    trustTest();
    expect(checkHardwareKeyAttestation(attObj('packed', [...testVendor().chainPem, TEST_ROOT_PEM].map(der)), MODEL)).toBeNull();
  });

  it.each([
    ['format none', attObj('none'), 'no_attestation'],
    ['self attestation (packed, no certificate)', attObj('packed'), 'no_attestation'],
    ['an empty chain', attObj('packed', []), 'no_attestation'],
    ['garbage', new Uint8Array([1, 2, 3]), 'no_attestation'],
  ])('refuses %s', (_l, obj, reason) => {
    trustTest();
    expect(checkHardwareKeyAttestation(obj as Uint8Array<ArrayBuffer>, MODEL)).toBe(reason);
  });

  it('refuses another vendor', () => {
    trustTest();
    expect(checkHardwareKeyAttestation(attObj('packed', otherVendor().chainPem.map(der)), MODEL)).toBe('unknown_vendor');
  });

  it('refuses a leaf without its intermediate (no path to the root)', () => {
    trustTest();
    expect(checkHardwareKeyAttestation(attObj('packed', [der(testVendor().chainPem[0])]), MODEL)).toBe('unknown_vendor');
  });

  it('refuses a chain in the wrong order', () => {
    trustTest();
    expect(checkHardwareKeyAttestation(attObj('packed', [...testVendor().chainPem].reverse().map(der)), MODEL)).toBe('bad_chain');
  });

  it('refuses an expired chain', () => {
    trustTest();
    const later = Date.parse('2200-01-01');
    expect(checkHardwareKeyAttestation(attObj('packed', testVendor().chainPem.map(der)), MODEL, later)).toBe('bad_chain');
  });

  it('refuses a leaf that is not a FIDO attestation certificate (e.g. PIV), even under a trusted root', () => {
    const fx = (f: string) => readFileSync(join(__dirname, 'fixtures', 'attestation', f), 'utf8');
    __setHardwareKeyRoots([fx('nofido-root.pem')]);
    expect(checkHardwareKeyAttestation(attObj('packed', [der(fx('nofido-leaf.pem'))]), MODEL)).toBe('bad_chain');
  });

  it('refuses a CA certificate as the leaf', () => {
    trustTest();
    expect(checkHardwareKeyAttestation(attObj('packed', [der(testVendor().chainPem[1])]), MODEL)).toBe('bad_chain');
  });

  it('refuses a blank model ID', () => {
    trustTest();
    const chain = testVendor().chainPem.map(der);
    expect(checkHardwareKeyAttestation(attObj('packed', chain), '00000000-0000-0000-0000-000000000000')).toBe('no_model');
    expect(checkHardwareKeyAttestation(attObj('packed', chain), undefined)).toBe('no_model');
  });
});
