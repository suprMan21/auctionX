import { describe, it, expect, beforeEach } from 'vitest';
import { hasSunParams, withoutSunParams } from './tapUrl';
import { forgetTapSession, loadTap, saveTap } from './tapCache';
import { safeNextPath } from '@/features/auth/lib/safeNext';
import type { TapResult } from '../api/schemas';
import { tokenDisplayName } from './tokenName';

const PICC = 'EF963FF7828658A599F3041510671E88';
const CMAC = '94EED9EE65337086';

describe('tapUrl', () => {
  it('recognises long and short SUN parameters', () => {
    expect(hasSunParams(`?picc_data=${PICC}&cmac=${CMAC}`)).toBe(true);
    expect(hasSunParams(`?e=${PICC}&c=${CMAC}`)).toBe(true);
    // S-NFC-ID v2 chips put their serial first
    expect(hasSunParams(`?sn=5A1E7C0D93B2468F&picc_data=${PICC}&cmac=${CMAC}`)).toBe(true);
  });

  it('rejects missing or non-hex parameters', () => {
    expect(hasSunParams('')).toBe(false);
    expect(hasSunParams(`?picc_data=${PICC}`)).toBe(false);
    expect(hasSunParams(`?picc_data=${PICC}&cmac=<script>`)).toBe(false);
  });

  it('strips only the SUN parameters', () => {
    expect(withoutSunParams(`?picc_data=${PICC}&cmac=${CMAC}`)).toBe('');
    expect(withoutSunParams(`?ref=qr&e=${PICC}&c=${CMAC}`)).toBe('?ref=qr');
    expect(withoutSunParams(`?sn=5A1E7C0D93B2468F&picc_data=${PICC}&cmac=${CMAC}&ref=qr`)).toBe('?ref=qr');
  });
});

describe('tapCache', () => {
  const tap: TapResult = {
    valid: true,
    tagId: 't1',
    lifecycleStatus: 'ENROLLED',
    provenance: null,
    tapSession: { token: 'A'.repeat(43), expiresAt: '2099-01-01T00:00:00.000Z' },
    viewer: null,
  };

  beforeEach(() => sessionStorage.clear());

  it('round-trips a tap for the same token name only', () => {
    saveTap('chip_001', tap);
    expect(loadTap('chip_001')).toEqual(tap);
    expect(loadTap('chip_002')).toBeNull();
  });

  it('expires after 10 minutes', () => {
    saveTap('chip_001', tap, 0);
    expect(loadTap('chip_001', 10 * 60 * 1000 + 1)).toBeNull();
  });

  it('drops a corrupted entry instead of throwing', () => {
    sessionStorage.setItem('am.tap.chip_001', '{not json');
    expect(loadTap('chip_001')).toBeNull();
  });

  it('forgets a spent tap session but keeps the verification', () => {
    saveTap('chip_001', tap);
    forgetTapSession('chip_001');
    expect(loadTap('chip_001')).toMatchObject({ valid: true, tapSession: null });
  });
});

describe('safeNextPath', () => {
  it('accepts same-origin app paths', () => {
    expect(safeNextPath('/verify/chip_001', '/tokens')).toBe('/verify/chip_001');
    expect(safeNextPath('/tokens?x=1#y', '/tokens')).toBe('/tokens?x=1#y');
  });

  it.each([
    'https://evil.example/',
    '//evil.example/path',
    '/.//evil.example',
    '/%2e//evil.example',
    '/a/..//evil.example',
    '/./%2e/..//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    'tokens',
    '',
  ])('falls back for %s', (raw) => {
    expect(safeNextPath(raw, '/tokens')).toBe('/tokens');
  });

  it('falls back when absent', () => {
    expect(safeNextPath(null, '/tokens')).toBe('/tokens');
  });
});

describe('tokenDisplayName', () => {
  const tagId = '7c9960df-0000-4000-8000-000000000000';

  it('prefers the item title, then the seal code, then the serial suffix, then the tag id; never the chip name', () => {
    expect(tokenDisplayName({ tagId, title: 'Signed jersey', chipName: 'chip_004', serialSuffix: 'AE6CA9' })).toBe('Signed jersey');
    expect(tokenDisplayName({ tagId, title: null, chipName: 'chip_004', serialSuffix: 'AE6CA9' })).toBe('Seal …AE6CA9');
    expect(tokenDisplayName({ tagId, title: null, chipName: 'chip_004' })).toBe('Seal 7C9960DF');
    // S-SEAL1: the seal code wins over the internal chip name.
    expect(tokenDisplayName({ tagId, title: null, sealCode: '7K3Q-9XWD', chipName: 'chip_004' })).toBe('Seal 7K3Q-9XWD');
    expect(tokenDisplayName({ tagId, title: 'Signed jersey', sealCode: '7K3Q-9XWD' })).toBe('Signed jersey');
    expect(tokenDisplayName({ tagId, title: null, chipName: null, serialSuffix: 'AE6CA9' })).toBe('Seal …AE6CA9');
    expect(tokenDisplayName({ tagId, title: null })).toBe('Seal 7C9960DF');
  });
});
