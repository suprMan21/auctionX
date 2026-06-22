import { describe, it, expect } from 'vitest';
import {
  buildPiccPlaintext,
  encryptPiccData,
  decryptPiccData,
  computeCmac,
  truncateCmac,
  verifyCmac,
  parseSunMessage,
  buildSunUrl,
} from '../services/nfc/ntag424Codec';
import { validateScan } from '../services/nfc/ntag424';
import { simulateTap } from '../services/nfc/ntag424Simulator';
import vectorFixtures from '../services/nfc/__fixtures__/ntag424_vectors.json';

interface GoldenVector {
  label: string;
  uid: string;
  counter: number;
  aesKey: string;
  baseUrl: string;
  tokenName: string;
  piccPlaintext: string;
  piccData: string;
  cmacFull: string;
  cmac: string;
  sunUrl: string;
}

const vectors = (vectorFixtures as { vectors: GoldenVector[] }).vectors;

describe('ntag424Codec — primitives', () => {
  const uid = '04A27E02936980';
  const key = '000102030405060708090A0B0C0D0E0F';

  it('buildPiccPlaintext produces 0xC7 || UID(7) || counter(3 LE) || 0x00*5', () => {
    const block = buildPiccPlaintext(uid, 1);
    expect(block.length).toBe(16);
    expect(block.toString('hex').toUpperCase()).toBe('C704A27E029369800100000000000000');
  });

  it('buildPiccPlaintext encodes the counter little-endian', () => {
    const block = buildPiccPlaintext(uid, 0x010203);
    expect(block[8]).toBe(0x03);
    expect(block[9]).toBe(0x02);
    expect(block[10]).toBe(0x01);
  });

  it('rejects malformed UID and out-of-range counter', () => {
    expect(() => buildPiccPlaintext('ABC', 0)).toThrow();
    expect(() => buildPiccPlaintext(uid, -1)).toThrow();
    expect(() => buildPiccPlaintext(uid, 0x1000000)).toThrow();
    expect(() => encryptPiccData(uid, 0, 'ZZ')).toThrow();
  });

  it('encrypt → decrypt round-trips UID and counter', () => {
    for (const counter of [0, 1, 42, 0xffffff]) {
      const enc = encryptPiccData(uid, counter, key);
      const dec = decryptPiccData(enc, key);
      expect(dec).not.toBeNull();
      expect(dec!.uid).toBe(uid.toUpperCase());
      expect(dec!.counter).toBe(counter);
    }
  });

  it('decryptPiccData returns null on wrong key (header byte mismatch)', () => {
    const enc = encryptPiccData(uid, 5, key);
    const dec = decryptPiccData(enc, 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF');
    expect(dec).toBeNull();
  });

  it('computeCmac returns full 16-byte (32 hex) uppercase MAC; truncateCmac takes first 8 bytes', () => {
    const enc = encryptPiccData(uid, 1, key);
    const full = computeCmac(enc, key);
    expect(full).toMatch(/^[0-9A-F]{32}$/);
    const trunc = truncateCmac(full);
    expect(trunc).toBe(full.substring(0, 16));
    expect(trunc.length).toBe(16);
  });

  it('verifyCmac accepts the truncated CMAC and rejects tampered ones', () => {
    const enc = encryptPiccData(uid, 1, key);
    const trunc = truncateCmac(computeCmac(enc, key));
    expect(verifyCmac(enc, key, trunc)).toBe(true);
    expect(verifyCmac(enc, key, trunc.toLowerCase())).toBe(true);
    expect(verifyCmac(enc, key, '0000000000000000')).toBe(false);
    expect(verifyCmac(enc, 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF', trunc)).toBe(false);
  });

  it('parseSunMessage extracts picc_data/cmac (and short aliases)', () => {
    expect(parseSunMessage('https://x.io/verify/t?picc_data=AA&cmac=BB')).toEqual({
      encPiccData: 'AA',
      cmac: 'BB',
    });
    expect(parseSunMessage('https://x.io/verify/t?e=CC&c=DD')).toEqual({
      encPiccData: 'CC',
      cmac: 'DD',
    });
    expect(parseSunMessage('https://x.io/verify/t?picc_data=AA')).toBeNull();
    expect(parseSunMessage('not a url')).toBeNull();
  });

  it('buildSunUrl trims trailing slash and uses the verify/{token} layout', () => {
    expect(buildSunUrl('https://x.io/', 'tok', 'AA', 'BB')).toBe(
      'https://x.io/verify/tok?picc_data=AA&cmac=BB',
    );
  });
});

describe('ntag424 simulator ↔ validateScan integration', () => {
  it('a simulateTap output validates through validateScan', () => {
    const uid = '04A27E02936980';
    const key = '0F0E0D0C0B0A09080706050403020100';
    const tap = simulateTap({
      tagUid: uid,
      counter: 7,
      aesKeyHex: key,
      baseUrl: 'https://verify.example.com',
      tokenName: 'tag-xyz',
    });

    const result = validateScan({
      tagUid: uid,
      sunMessage: tap.sunUrl,
      storedAesKey: key,
      lastCounter: 0,
    });

    expect(result.valid).toBe(true);
    expect(result.decryptedUid).toBe(uid);
    expect(result.counterValue).toBe(7);
  });

  it('validateScan rejects a replayed counter', () => {
    const uid = '11223344556677';
    const key = 'FFEEDDCCBBAA99887766554433221100';
    const tap = simulateTap({
      tagUid: uid,
      counter: 5,
      aesKeyHex: key,
      baseUrl: 'https://verify.example.com',
      tokenName: 'tag-xyz',
    });

    const result = validateScan({
      tagUid: uid,
      sunMessage: tap.sunUrl,
      storedAesKey: key,
      lastCounter: 5,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Counter replay detected');
  });

  it('validateScan rejects a UID mismatch', () => {
    const key = '0F0E0D0C0B0A09080706050403020100';
    const tap = simulateTap({
      tagUid: '04A27E02936980',
      counter: 1,
      aesKeyHex: key,
      baseUrl: 'https://verify.example.com',
      tokenName: 'tag-xyz',
    });

    const result = validateScan({
      tagUid: '11223344556677',
      sunMessage: tap.sunUrl,
      storedAesKey: key,
      lastCounter: 0,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe('UID mismatch');
  });
});

describe('ntag424Codec — golden parity vectors (shared with Python encoder)', () => {
  it.each(vectors)('matches fixture: $label', (v) => {
    expect(buildPiccPlaintext(v.uid, v.counter).toString('hex').toUpperCase()).toBe(v.piccPlaintext);

    const picc = encryptPiccData(v.uid, v.counter, v.aesKey);
    expect(picc).toBe(v.piccData);

    const full = computeCmac(picc, v.aesKey);
    expect(full).toBe(v.cmacFull);
    expect(truncateCmac(full)).toBe(v.cmac);
    expect(verifyCmac(picc, v.aesKey, v.cmac)).toBe(true);

    expect(buildSunUrl(v.baseUrl, v.tokenName, v.piccData, v.cmac)).toBe(v.sunUrl);

    // round-trip through decrypt
    const dec = decryptPiccData(v.piccData, v.aesKey);
    expect(dec).not.toBeNull();
    expect(dec!.uid).toBe(v.uid.toUpperCase());
    expect(dec!.counter).toBe(v.counter);

    // simulateTap reproduces the full fixture
    const tap = simulateTap({
      tagUid: v.uid,
      counter: v.counter,
      aesKeyHex: v.aesKey,
      baseUrl: v.baseUrl,
      tokenName: v.tokenName,
    });
    expect(tap.piccData).toBe(v.piccData);
    expect(tap.cmac).toBe(v.cmac);
    expect(tap.sunUrl).toBe(v.sunUrl);
  });
});
