/**
 * S-SEAL1 Ph2: the seal spec. One JSON per seal, built here and stored on the tag, drawn the same
 * way by the website (SealBadge), the server (preview + share images) and later the app.
 *
 * The pattern is decoration, not security: it is seeded from the public seal code, so anyone
 * can rebuild it. Only a tap proves a seal.
 */
import { createHash } from 'node:crypto';

export const SEAL_SPEC_VERSION = 1;
export const PATTERN_VERSION = 1;

export type SealSpec = {
  v: typeof SEAL_SPEC_VERSION;
  /** Seal code as stored (8 Crockford base32 characters, no hyphen). */
  code: string;
  /** Key into AM's colour pairs (lib/seal/colorPairs.ts). One pair until S-SEAL2. */
  colors: 'am-default';
  pattern: {
    kind: 'hypotrochoid';
    version: typeof PATTERN_VERSION;
    /** SVG path strings in the badge's 120×120 box, centred on (60, 60). */
    paths: string[];
  };
};

const STORED_CODE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

/** Badge centre and the radii the pattern must stay inside (inner circle of the badge is r = 31). */
const CX = 60;
const CY = 60;
const OUTER_RADIUS = 29;
const INNER_RADIUS = 17;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Small reader over the seed bytes; each call takes the next byte. */
const byteReader = (seed: Buffer) => {
  let i = 0;
  return () => seed[i++ % seed.length];
};

/**
 * Allowed (R, r) pairs, Boss 2026-10-28: close to GPKD-67QP's look. 13, 14 or 16 petals, 3 loops, small rolling
 * circle (r/R 0.18 to 0.24), so the loops stay in an even band near the rim. Seals differ in petal count,
 * loop depth and angle.
 */
const SHAPES: ReadonlyArray<readonly [number, number]> = (() => {
  const out: Array<[number, number]> = [];
  for (let R = 12; R <= 20; R++) {
    for (let r = 2; r < R - 1; r++) {
      const g = gcd(R, r);
      const petals = R / g;
      const loops = r / g;
      // g === 1 keeps one entry per curve (26/6 draws the same curve as 13/3).
      if (g === 1 && petals >= 13 && petals <= 16 && loops === 3 && r / R >= 0.18 && r / R <= 0.24) out.push([R, r]);
    }
  }
  return out;
})();

/**
 * One hypotrochoid: x = (R−r)cos t + d·cos((R−r)t/r), y = (R−r)sin t − d·sin((R−r)t/r),
 * scaled so its farthest point sits on `radius`, then turned by `angle`.
 */
const hypotrochoidPath = (R: number, r: number, dRatio: number, radius: number, angle: number): string => {
  const d = r * dRatio;
  const loops = r / gcd(R, r);
  // Enough points per petal that big, open loops stay round.
  const steps = 28 * (R / gcd(R, r));
  const span = 2 * Math.PI * loops;
  const pts: Array<[number, number]> = [];
  let max = 0;
  for (let s = 0; s < steps; s++) {
    const t = (s / steps) * span;
    const k = ((R - r) / r) * t;
    const x = (R - r) * Math.cos(t) + d * Math.cos(k);
    const y = (R - r) * Math.sin(t) - d * Math.sin(k);
    max = Math.max(max, Math.hypot(x, y));
    pts.push([x, y]);
  }
  const scale = radius / max;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const fmt = (n: number) => (Math.round(n * 10) / 10).toString().replace(/^(-?)0\./, '$1.');
  // Absolute start, then relative steps on a 0.1 grid (shorter strings; rounding never accumulates
  // because each step is taken from the rounded previous point).
  let prevX = 0;
  let prevY = 0;
  const parts = pts.map(([x, y], i) => {
    const px = Math.round((CX + (x * cos - y * sin) * scale) * 10);
    const py = Math.round((CY + (x * sin + y * cos) * scale) * 10);
    const out = i === 0 ? `M${fmt(px / 10)} ${fmt(py / 10)}` : `l${fmt((px - prevX) / 10)} ${fmt((py - prevY) / 10)}`;
    prevX = px;
    prevY = py;
    return out;
  });
  return parts.join('').replace(/ -/g, '-') + 'Z';
};

/** Builds the seal spec for a stored seal code. Pure: the same code always gives the same spec. */
export const buildSealSpec = (code: string): SealSpec => {
  if (!STORED_CODE.test(code)) throw new Error('buildSealSpec: not a stored seal code');
  const seed = createHash('sha256').update(`am-seal-v1|${code}`).digest();
  const next = byteReader(seed);

  const pick = () => SHAPES[((next() << 8) | next()) % SHAPES.length];
  const ratio = (lo: number, hi: number) => lo + (next() / 255) * (hi - lo);
  const turn = () => (next() / 256) * 2 * Math.PI;

  const [R1, r1] = pick();
  const [R2, r2] = pick();
  const paths = [
    hypotrochoidPath(R1, r1, ratio(1.65, 1.9), OUTER_RADIUS, turn()),
    hypotrochoidPath(R2, r2, ratio(1.15, 1.35), INNER_RADIUS, turn()),
  ];

  return {
    v: SEAL_SPEC_VERSION,
    code,
    colors: 'am-default',
    pattern: { kind: 'hypotrochoid', version: PATTERN_VERSION, paths },
  };
};
