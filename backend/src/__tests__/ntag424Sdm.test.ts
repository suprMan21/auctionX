import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  aesCmac,
  buildPiccPlaintext,
  buildSv2,
  computeFullSdmMac,
  computeSdmMac,
  decryptPiccBlock,
  decryptPiccData,
  deriveSessionMacKey,
  encryptPiccBlock,
  extractMacInput,
  isAcceptablePiccDataTag,
  parsePiccDataTag,
  parsePiccPlaintext,
  parseSunMessage,
  truncateSdmMac,
  v2MacInput,
  verifySdmMac,
} from '../services/nfc/ntag424Codec';
import { validateSunScan } from '../services/nfc/ntag424';
import { simulateTap } from '../services/nfc/ntag424Simulator';
import { createLocalTagKeyProvider } from '../services/nfc/keys/tagKeyProvider';
import { hex, loadSharedVectors, testAudit, toHex } from './helpers/sdmVectors';

/**
 * S-NFC3.5 — NXP AN12196 SDM, byte for byte, against the SHARED OpenSSL
 * vector file (test-vectors/ntag424_sdm_vectors.json). The same file is loaded
 * by tag-encoder pytest and tag-hq pytest.
 */

const timingSafe = vi.hoisted(() => ({ calls: 0 }));
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  return {
    ...actual,
    timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => {
      timingSafe.calls += 1;
      return actual.timingSafeEqual(a, b);
    },
  };
});

const vectors = loadSharedVectors();
const golden = vectors.sdm.find((v) => v.name === 'an12196_golden_zero_keys')!;

let quiet: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => quiet.mockRestore());

describe('shared vector file', () => {
  it('is the OpenSSL-generated file with the AN12196 golden vector in it', () => {
    expect(vectors._openssl).toMatch(/OpenSSL/);
    expect(vectors.sdm.length).toBeGreaterThanOrEqual(5);
    expect(vectors.kdf.length).toBeGreaterThanOrEqual(12);
    expect(golden).toBeDefined();
  });
});

describe('AN12196 golden vector #1 (all-zero keys) — every intermediate', () => {
  const meta = hex(golden.sdmMetaReadKey);
  const file = hex(golden.sdmFileReadKey);

  it('ENCPICCData decrypts to C7 04DE5F1EACC040 3D0000 DA5CF60941', () => {
    const plain = decryptPiccBlock(hex(golden.encPiccData), meta);
    expect(toHex(plain)).toBe('C704DE5F1EACC0403D0000DA5CF60941');
  });

  it('parses PICCDataTag C7 -> UID 04DE5F1EACC040, SDMReadCtr 3D0000 LE = 61', () => {
    const picc = decryptPiccData(hex(golden.encPiccData), meta)!;
    expect(picc.uidHex).toBe('04DE5F1EACC040');
    expect(toHex(picc.counterLE)).toBe('3D0000');
    expect(picc.counter).toBe(61);
  });

  it('SV2 = 3CC300010080 || UID || ctr(LE)', () => {
    expect(toHex(buildSv2(hex('04DE5F1EACC040'), hex('3D0000')))).toBe('3CC30001008004DE5F1EACC0403D0000');
  });

  it('KSesSDMFileReadMAC = 3FB5F6E3A807A03D5E3570ACE393776F', () => {
    expect(toHex(deriveSessionMacKey(file, hex('04DE5F1EACC040'), hex('3D0000')))).toBe(
      '3FB5F6E3A807A03D5E3570ACE393776F',
    );
  });

  it('full CMAC over the empty MAC input = E194C7EE12D9F7EE8A65C8331B704386', () => {
    expect(toHex(computeFullSdmMac(file, hex('04DE5F1EACC040'), hex('3D0000'), Buffer.alloc(0)))).toBe(
      'E194C7EE12D9F7EE8A65C8331B704386',
    );
  });

  it('truncated (even-numbered bytes) = 94EED9EE65337086', () => {
    expect(toHex(truncateSdmMac(hex('E194C7EE12D9F7EE8A65C8331B704386')))).toBe('94EED9EE65337086');
    expect(toHex(computeSdmMac(file, hex('04DE5F1EACC040'), hex('3D0000'), Buffer.alloc(0)))).toBe(
      '94EED9EE65337086',
    );
  });

  it('verifies, and verifies in constant time', () => {
    const before = timingSafe.calls;
    expect(
      verifySdmMac(file, hex('04DE5F1EACC040'), hex('3D0000'), Buffer.alloc(0), hex('94EED9EE65337086')),
    ).toBe(true);
    expect(timingSafe.calls).toBe(before + 1);
  });
});

describe.each(vectors.sdm.map((v) => [v.name, v] as const))('shared SDM vector %s', (_name, v) => {
  const meta = hex(v.sdmMetaReadKey);
  const file = hex(v.sdmFileReadKey);
  const uid = hex(v.uid);
  const ctr = hex(v.counterLE);

  it('decrypt side: every intermediate', () => {
    expect(toHex(decryptPiccBlock(hex(v.encPiccData), meta))).toBe(v.piccPlaintext);
    const picc = decryptPiccData(hex(v.encPiccData), meta)!;
    expect(picc.uidHex).toBe(v.uid);
    expect(picc.counter).toBe(v.counter);
    expect(toHex(picc.counterLE)).toBe(v.counterLE);
    expect(toHex(buildSv2(uid, ctr))).toBe(v.sv2);
    expect(toHex(deriveSessionMacKey(file, uid, ctr))).toBe(v.sessionMacKey);
    expect(toHex(computeFullSdmMac(file, uid, ctr, hex(v.macInput)))).toBe(v.fullCmac);
    expect(toHex(computeSdmMac(file, uid, ctr, hex(v.macInput)))).toBe(v.truncatedCmac);
    expect(verifySdmMac(file, uid, ctr, hex(v.macInput), hex(v.truncatedCmac))).toBe(true);
  });

  it('encode side: PICCData plaintext + ciphertext', () => {
    const plain = buildPiccPlaintext(uid, v.counter, hex(v.piccPadding));
    expect(toHex(plain)).toBe(v.piccPlaintext);
    expect(toHex(encryptPiccBlock(plain, meta))).toBe(v.encPiccData);
  });

  it('every single flipped MAC byte fails', () => {
    for (let i = 0; i < 8; i++) {
      const bad = hex(v.truncatedCmac);
      bad[i] ^= 0x01;
      expect(verifySdmMac(file, uid, ctr, hex(v.macInput), bad)).toBe(false);
    }
  });
});

describe('PICCDataTag (shared vectors)', () => {
  it.each(vectors.piccDataTag.map((t) => [t.byte, t] as const))('0x%s', (_b, t) => {
    const parsed = parsePiccDataTag(parseInt(t.byte, 16));
    expect(parsed).toEqual({ uidMirrored: t.uidMirrored, ctrMirrored: t.ctrMirrored, uidLength: t.uidLength });
    expect(isAcceptablePiccDataTag(parsed)).toBe(t.accept);
  });

  it('rejects a decrypted block whose tag is unacceptable', () => {
    const plain = hex(golden.piccPlaintext);
    for (const t of vectors.piccDataTag.filter((x) => !x.accept)) {
      plain[0] = parseInt(t.byte, 16);
      expect(parsePiccPlaintext(plain)).toBeNull();
    }
  });

  it('a wrong META key does not yield an acceptable PICCData for the golden vector', () => {
    expect(decryptPiccData(hex(golden.encPiccData), hex('11'.repeat(16)))).toBeNull();
  });
});

describe('AES-CMAC (RFC 4493 KATs, incl. the empty message SDM uses)', () => {
  const key = hex('2B7E151628AED2A6ABF7158809CF4F3C');
  it.each([
    ['', 'BB1D6929E95937287FA37D129B756746'],
    ['6BC1BEE22E409F96E93D7E117393172A', '070A16B46B4D4144F79BDD9DD04A287C'],
    [
      '6BC1BEE22E409F96E93D7E117393172AAE2D8A571E03AC9C9EB76FAC45AF8E5130C81C46A35CE411',
      'DFA66747DE9AE63030CA32611497C827',
    ],
    [
      '6BC1BEE22E409F96E93D7E117393172AAE2D8A571E03AC9C9EB76FAC45AF8E5130C81C46A35CE411E5FBC1191A0A52EFF69F2445DF4F9B17AD2B417BE66C3710',
      '51F0BEBF7E3B9D92FC49741779363CFE',
    ],
  ])('M=%s', (m, expected) => {
    expect(toHex(aesCmac(key, hex(m)))).toBe(expected);
  });
});

describe('MAC input range', () => {
  it('is bytes [SDMMACInputOffset, SDMMACOffset) of the file', () => {
    const file = Buffer.from('0123456789ABCDEF', 'ascii');
    expect(extractMacInput(file, 4, 9).toString('ascii')).toBe('45678');
    expect(extractMacInput(file, 7, 7).length).toBe(0);
  });

  it('rejects an inverted or out-of-bounds range', () => {
    const file = Buffer.alloc(8);
    expect(() => extractMacInput(file, 5, 4)).toThrow();
    expect(() => extractMacInput(file, 0, 9)).toThrow();
    expect(() => extractMacInput(file, -1, 2)).toThrow();
  });

  it('a non-empty range verifies (shared vector) and is bound into the MAC', () => {
    const v = vectors.sdm.find((x) => x.macInput !== '')!;
    const args = [hex(v.sdmFileReadKey), hex(v.uid), hex(v.counterLE)] as const;
    expect(verifySdmMac(...args, hex(v.macInput), hex(v.truncatedCmac))).toBe(true);
    expect(verifySdmMac(...args, Buffer.alloc(0), hex(v.truncatedCmac))).toBe(false);
  });
});

describe('URL parsing', () => {
  it('accepts picc_data/cmac and e/c, rejects malformed hex', () => {
    const e = golden.encPiccData;
    const c = golden.truncatedCmac;
    expect(parseSunMessage(`https://x.test/verify/t?picc_data=${e}&cmac=${c}`)).toEqual({ encPiccData: e, cmac: c });
    expect(parseSunMessage(`https://x.test/?e=${e}&c=${c}`)).toEqual({ encPiccData: e, cmac: c });
    expect(parseSunMessage(`https://x.test/?e=${e}&c=${c.slice(2)}`)).toBeNull();
    expect(parseSunMessage(`https://x.test/?e=${e}ZZ&c=${c}`)).toBeNull();
    expect(parseSunMessage('not a url')).toBeNull();
  });
});

describe('end-to-end: local provider -> simulateTap -> validateSunScan (KDF chain vectors)', () => {
  const chainA = vectors.kdfChain[0];
  const chainB = vectors.kdfChain[1];
  const provider = createLocalTagKeyProvider({ sdmRootKeyHex: chainA.rootKey, allowLocalKeys: true });

  const tap = async (uid: string, counter: number, padding: string) =>
    simulateTap({
      tagUid: uid,
      counter,
      version: 1,
      baseUrl: 'https://am.example',
      tokenName: 'tok',
      provider,
      audit: testAudit,
      padding: hex(padding),
    });

  it('the simulator reproduces the OpenSSL chain vector byte for byte', async () => {
    for (const v of [chainA, chainB]) {
      const out = await tap(v.uid, v.counter, v.piccPadding);
      expect(out.piccData).toBe(v.encPiccData);
      expect(out.cmac).toBe(v.truncatedCmac);
    }
  });

  const validate = async (url: string, lastCounter: number, expectedUid?: string) =>
    validateSunScan({
      parts: parseSunMessage(url),
      version: 1,
      lastCounter,
      expectedUid,
      provider,
      audit: testAudit,
    });

  it('accepts a fresh tap', async () => {
    const { sunUrl } = await tap(chainA.uid, chainA.counter, chainA.piccPadding);
    expect(await validate(sunUrl, 4, chainA.uid)).toEqual({
      valid: true,
      decryptedUid: chainA.uid,
      counterValue: chainA.counter,
    });
  });

  it('replayed URL -> replay_detected', async () => {
    const { sunUrl } = await tap(chainA.uid, 5, '0102030405');
    expect((await validate(sunUrl, 5, chainA.uid)).error).toBe('replay_detected');
    expect((await validate(sunUrl, 9, chainA.uid)).error).toBe('replay_detected');
  });

  it('one flipped MAC byte -> invalid_signature (checked before the counter)', async () => {
    const { piccData, cmac } = await tap(chainA.uid, 5, '0102030405');
    const bad = hex(cmac);
    bad[3] ^= 0x80;
    const url = `https://am.example/verify/tok?picc_data=${piccData}&cmac=${toHex(bad)}`;
    expect((await validate(url, 0, chainA.uid)).error).toBe('invalid_signature');
    expect((await validate(url, 99, chainA.uid)).error).toBe('invalid_signature');
  });

  it('Tag-A URL with Tag-B UID fails', async () => {
    const { sunUrl } = await tap(chainA.uid, 5, '0102030405');
    const r = await validate(sunUrl, 0, chainB.uid);
    expect(r.valid).toBe(false);
    expect(r.error).toBe('uid_mismatch');
  });

  it("Tag-A PICCData spliced with Tag-B's MAC fails", async () => {
    const a = await tap(chainA.uid, 5, '0102030405');
    const b = await tap(chainB.uid, 5, '0102030405');
    const url = `https://am.example/verify/tok?picc_data=${a.piccData}&cmac=${b.cmac}`;
    expect((await validate(url, 0, chainA.uid)).error).toBe('invalid_signature');
  });

  it('a chip encoded under a different SDM root fails', async () => {
    const other = createLocalTagKeyProvider({ sdmRootKeyHex: 'AB'.repeat(32), allowLocalKeys: true });
    const forged = await simulateTap({
      tagUid: chainA.uid, counter: 5, version: 1, baseUrl: 'https://am.example', tokenName: 'tok',
      provider: other, audit: testAudit,
    });
    expect((await validate(forged.sunUrl, 0, chainA.uid)).valid).toBe(false);
  });

  it('a key version mismatch fails', async () => {
    const { sunUrl } = await tap(chainA.uid, 5, '0102030405');
    const r = await validateSunScan({
      parts: parseSunMessage(sunUrl), version: 2, lastCounter: 0, expectedUid: chainA.uid,
      provider, audit: testAudit,
    });
    expect(r.valid).toBe(false);
  });

  it('malformed input -> malformed', async () => {
    expect((await validate('https://am.example/verify/tok?picc_data=00&cmac=11', 0)).error).toBe('malformed');
  });
});

describe('S-NFC-ID v2: serial in the URL, the KDF and the MAC input (shared OpenSSL vectors)', () => {
  const v2 = vectors.kdfChain.filter((v) => v.version === 2);
  const provider = createLocalTagKeyProvider({ sdmRootKeyHex: v2[0].rootKey, allowLocalKeys: true });

  it('there are two v2 chain vectors on ONE UID with different serials', () => {
    expect(v2).toHaveLength(2);
    expect(v2[0].uid).toBe(v2[1].uid);
    expect(v2[0].serial).not.toBe(v2[1].serial);
    expect(v2[0].sdmFileReadKey).not.toBe(v2[1].sdmFileReadKey);
  });

  it.each(v2.map((v) => [v.name, v] as const))('%s: simulator reproduces OpenSSL byte for byte', async (_n, v) => {
    const out = await simulateTap({
      tagUid: v.uid, counter: v.counter, version: 2, baseUrl: 'https://am.example', tokenName: 'tok',
      provider, audit: testAudit, padding: hex(v.piccPadding), serial: v.serial,
    });
    expect(toHex(v2MacInput(v.serial, out.piccData))).toBe(v.macInput);
    expect(out.piccData).toBe(v.encPiccData);
    expect(out.cmac).toBe(v.truncatedCmac);
    expect(out.sunUrl).toContain(`?sn=${v.serial}&picc_data=${v.encPiccData}&cmac=${v.truncatedCmac}`);
    expect(parseSunMessage(out.sunUrl)).toEqual({ encPiccData: v.encPiccData, cmac: v.truncatedCmac, serial: v.serial });
  });

  const validate = (url: string, expectedSerial: string | null | undefined, version = 2) =>
    validateSunScan({
      parts: parseSunMessage(url), version, lastCounter: 0, expectedUid: v2[0].uid, expectedSerial,
      provider, audit: testAudit,
    });

  const urlOf = (v: (typeof v2)[number]) =>
    `https://am.example/verify/tok?sn=${v.serial}&picc_data=${v.encPiccData}&cmac=${v.truncatedCmac}`;

  it('accepts each chip under its own serial', async () => {
    for (const v of v2) expect((await validate(urlOf(v), v.serial)).valid).toBe(true);
  });

  it("a URL naming the twin's serial is uid_mismatch for the named tag", async () => {
    expect((await validate(urlOf(v2[0]), v2[1].serial)).error).toBe('uid_mismatch');
  });

  it("chip A's PICCData + MAC under chip B's serial fails the MAC", async () => {
    const forged = urlOf(v2[0]).replace(v2[0].serial, v2[1].serial);
    expect((await validate(forged, undefined)).error).toBe('invalid_signature');
  });

  it('a v2 URL against a v1 row, or a v1-shaped URL against a v2 row, never verifies', async () => {
    expect((await validate(urlOf(v2[0]), null, 1)).valid).toBe(false);
    const stripped = urlOf(v2[0]).replace(`sn=${v2[0].serial}&`, '');
    expect((await validate(stripped, undefined, 2)).valid).toBe(false);
  });
});
