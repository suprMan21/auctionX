import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { SealBadge } from '@/components/seal/SealBadge';
import { isSealCode } from '@/components/seal/sealCode';

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
