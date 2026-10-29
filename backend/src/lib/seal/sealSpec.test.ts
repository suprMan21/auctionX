import { describe, expect, it } from 'vitest';
import { buildSealSpec, PATTERN_VERSION, SEAL_SPEC_VERSION } from './sealSpec';

const CODES = ['WAV4F6TT', 'JCF3MGCK', '5RQPP74E', 'GPKD67QP'];

/** Every absolute point of a path built from M + relative l steps. */
const points = (d: string): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  let x = 0;
  let y = 0;
  for (const m of d.matchAll(/([Ml])(-?\d*\.?\d+)(?: |(?=-))(-?\d*\.?\d+)/g)) {
    const a = Number(m[2]);
    const b = Number(m[3]);
    if (m[1] === 'M') { x = a; y = b; } else { x += a; y += b; }
    out.push([x, y]);
  }
  return out;
};

describe('buildSealSpec', () => {
  it('is deterministic: the same code always gives the same spec', () => {
    for (const code of CODES) expect(buildSealSpec(code)).toEqual(buildSealSpec(code));
  });

  it('gives different patterns for different codes', () => {
    const outers = new Set(CODES.map((c) => buildSealSpec(c).pattern.paths[0]));
    expect(outers.size).toBe(CODES.length);
  });

  it('records the versions and the code', () => {
    const spec = buildSealSpec('WAV4F6TT');
    expect(spec.v).toBe(SEAL_SPEC_VERSION);
    expect(spec.pattern.version).toBe(PATTERN_VERSION);
    expect(spec.pattern.kind).toBe('hypotrochoid');
    expect(spec.code).toBe('WAV4F6TT');
    expect(spec.colors).toBe('am-default');
    expect(spec.pattern.paths).toHaveLength(2);
  });

  it('keeps every point inside the badge inner circle (r = 31)', () => {
    for (const code of CODES) {
      for (const d of buildSealSpec(code).pattern.paths) {
        const pts = points(d);
        expect(pts.length).toBeGreaterThan(100);
        for (const [x, y] of pts) expect(Math.hypot(x - 60, y - 60)).toBeLessThanOrEqual(30);
      }
    }
  });

  it('stays under the 10 KB size budget', () => {
    for (const code of CODES) expect(JSON.stringify(buildSealSpec(code)).length).toBeLessThan(10_000);
  });

  it('refuses anything that is not a stored seal code', () => {
    for (const bad of ['WAV4-F6TT', 'wav4f6tt', 'WAV4F6T', 'WAV4F6TI', '']) {
      expect(() => buildSealSpec(bad)).toThrow();
    }
  });
});
