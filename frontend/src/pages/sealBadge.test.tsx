import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { SealBadge } from '@/components/seal/SealBadge';
import { isSealCode } from '@/components/seal/sealCode';
import type { SealSpecView } from '@/components/seal/sealSpec';
import { tapResultSchema } from '@/features/tokens/api/schemas';

const css = readFileSync(resolve(__dirname, '../components/seal/seal.css'), 'utf8');

describe('SealBadge states (S-SEAL1, DR-22 v1.1)', () => {
  it('is animated by default and still in the sealed state', () => {
    const { container, rerender } = render(<SealBadge code="7K3Q-9XWD" />);
    expect(container.querySelector('svg')).toHaveAttribute('data-seal-state', 'verified');
    expect(container.querySelector('svg')).not.toHaveClass('sealbadge--sealed');
    rerender(<SealBadge code="7K3Q-9XWD" state="sealed" />);
    expect(container.querySelector('svg')).toHaveClass('sealbadge--sealed');
  });

  it('glows every 3.0 s; the sealed state has no spin and no glow', () => {
    expect(css).toMatch(/\.sealbadge\{[^}]*animation:am-sealglow 3s/);
    expect(css).toMatch(/\.sealbadge--sealed\{[^}]*animation:none/);
    expect(css).toMatch(/\.sealbadge--sealed \.sealspin\{[^}]*animation:none/);
  });

  it('draws the seal code in bundled IBM Plex Mono (no CDN)', () => {
    const { container } = render(<SealBadge code="7K3Q-9XWD" />);
    const codeText = [...container.querySelectorAll('text')].find((t) => t.textContent === '7K3Q-9XWD');
    expect(codeText?.getAttribute('font-family')).toMatch(/^'IBM Plex Mono'/);
    expect(css).toMatch(/@font-face\{font-family:'IBM Plex Mono'[^}]*url\('\.\/fonts\//);
    expect(css).not.toMatch(/https?:\/\//);
  });

  it('accepts only display-form seal codes', () => {
    expect(isSealCode('7K3Q-9XWD')).toBe(true);
    for (const bad of ['7K3Q9XWD', 'ILOU-1234', '7k3q-9xwd', 'chip_004', null, undefined, 42]) expect(isSealCode(bad)).toBe(false);
  });
});

const SPEC: SealSpecView = {
  v: 1,
  colors: 'am-default',
  pattern: { kind: 'hypotrochoid', version: 1, paths: ['M81.5 40.5l-.6-.4l-.8-.2Z', 'M51.6 74.8l.2 0l.3-.1Z'] },
};

const mockReducedMotion = (reduce: boolean) =>
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query.includes('reduce'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );

describe('SealBadge pattern v1 (S-SEAL1 Ph2a)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('without a spec draws exactly what it drew before (no rings, no electrons)', () => {
    const { container } = render(<SealBadge code="7K3Q-9XWD" />);
    expect(container.querySelector('[data-seal-rings]')).toBeNull();
    expect(container.querySelector('animateMotion')).toBeNull();
    expect(container.querySelector('svg')).not.toHaveAttribute('data-seal-pattern');
  });

  it('Verified: both rings, two outer electrons and one inner electron going the other way', () => {
    mockReducedMotion(false);
    const { container } = render(<SealBadge code="7K3Q-9XWD" spec={SPEC} />);
    const rings = container.querySelector('[data-seal-rings]');
    expect(rings?.querySelector('.sealrot-out > path')?.getAttribute('d')).toBe(SPEC.pattern.paths[0]);
    expect(rings?.querySelector('.sealrot-in > path')?.getAttribute('d')).toBe(SPEC.pattern.paths[1]);
    // Each electron = 4 tail dots + 1 halo.
    expect(container.querySelectorAll('.sealrot-out animateMotion')).toHaveLength(10);
    const inner = [...container.querySelectorAll('.sealrot-in animateMotion')];
    expect(inner).toHaveLength(5);
    expect(inner.every((m) => m.getAttribute('keyPoints') === '1;0' && m.getAttribute('dur') === '20s')).toBe(true);
    const outerBegins = [...container.querySelectorAll('.sealrot-out animateMotion')].map((m) => m.getAttribute('begin'));
    expect(outerBegins).toContain('-15s'); // second electron half a lap behind
  });

  it('Sealed: the pattern is drawn still, with no electrons', () => {
    mockReducedMotion(false);
    const { container } = render(<SealBadge code="7K3Q-9XWD" spec={SPEC} state="sealed" />);
    expect(container.querySelector('[data-seal-rings]')).not.toBeNull();
    expect(container.querySelector('animateMotion')).toBeNull();
  });

  it('Reduce Motion: no electrons even while Verified, and the rings do not turn', () => {
    mockReducedMotion(true);
    const { container } = render(<SealBadge code="7K3Q-9XWD" spec={SPEC} />);
    expect(container.querySelector('[data-seal-rings]')).not.toBeNull();
    expect(container.querySelector('animateMotion')).toBeNull();
    expect(css).toMatch(/@media \(prefers-reduced-motion:reduce\)\{[^}]*\.sealrot-out,\.sealrot-in\{animation:none\}/);
    expect(css).toMatch(/\.sealbadge--sealed \.sealrot-out,\.sealbadge--sealed \.sealrot-in\{animation:none\}/);
  });

  it('rings turn at the Locked speeds (outer 48 s the other way, inner 30 s)', () => {
    expect(css).toMatch(/\.sealrot-out\{animation:am-sealspin 48s linear infinite reverse\}/);
    expect(css).toMatch(/\.sealrot-in\{animation:am-sealspin 30s linear infinite\}/);
  });

  it('never draws a path with anything but M / l / Z commands', () => {
    const bad: SealSpecView = { ...SPEC, pattern: { ...SPEC.pattern, paths: ['M0 0L9 9Z', SPEC.pattern.paths[1]] } };
    const { container } = render(<SealBadge code="7K3Q-9XWD" spec={bad} />);
    expect(container.querySelector('[data-seal-rings]')).toBeNull();
  });

  it('a malformed spec from the API is dropped, never fatal', () => {
    const base = { valid: true, tagId: 't', lifecycleStatus: 'ACTIVE', provenance: null, tapSession: null, viewer: null };
    const good = tapResultSchema.parse({ ...base, sealSpec: SPEC });
    expect(good.valid && good.sealSpec).toEqual(SPEC);
    const bad = tapResultSchema.parse({ ...base, sealSpec: { v: 1, colors: 'x', pattern: { paths: ['<script>'] } } });
    expect(bad.valid && bad.sealSpec).toBeNull();
    const missing = tapResultSchema.parse(base);
    expect(missing.valid && missing.sealSpec).toBeUndefined();
  });
});
