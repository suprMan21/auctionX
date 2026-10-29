import { describe, expect, it } from 'vitest';
import { buildSealSpec } from './sealSpec';
import { sealSvg } from './sealSvg';
import {
  outlinedSealSvg,
  PREVIEW_MAX_BYTES,
  previewSvg,
  renderPng,
  SEAL_IMAGE_COPY,
  SHARE_MAX_BYTES,
  shareSvg,
} from './sealImages';

const spec = buildSealSpec('WAV4F6TT');
const URL = 'https://staging.example/s/WAV4-F6TT';

/** Width and height from a PNG's IHDR chunk. */
const pngSize = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

describe('sealSvg (server Sealed seal)', () => {
  it('draws the code, both pattern rings and the muted Sealed look', () => {
    const svg = sealSvg(spec);
    expect(svg).toContain('WAV4-F6TT');
    for (const path of spec.pattern.paths) expect(svg).toContain(path);
    expect(svg).toContain('feColorMatrix');
  });

  it('never draws the Verified look (no motion, no holographic gradient, no sheen)', () => {
    const svg = sealSvg(spec);
    expect(svg).not.toMatch(/animate|holo|sheen|glint|mix-blend/i);
  });

  it('generic seal (null spec) has no code and no pattern', () => {
    const svg = sealSvg(null);
    expect(svg).not.toMatch(/[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}/);
    expect(svg).not.toContain('clip-path');
  });

  it('skips pattern paths that are not plain M / l / Z commands', () => {
    const bad = { ...spec, pattern: { ...spec.pattern, paths: ['M0 0"/><script/>', spec.pattern.paths[1]] } };
    const svg = sealSvg(bad);
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('clip-path');
  });

  it('keeps element ids inside its prefix', () => {
    const svg = sealSvg(spec, { idPrefix: 'ab"c' });
    expect(svg).toContain('id="abc-grad"');
    expect(svg).not.toContain('ab"c');
  });
});

describe('seal pictures', () => {
  it('preview is 1200 x 630 and inside its size budget', () => {
    const png = renderPng(previewSvg(spec, URL));
    expect(pngSize(png)).toEqual({ width: 1200, height: 630 });
    expect(png.length).toBeLessThan(PREVIEW_MAX_BYTES);
  });

  it('generic preview is 1200 x 630 and carries no seal code', () => {
    const svg = previewSvg(null, null);
    expect(svg).not.toMatch(/[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}/);
    expect(pngSize(renderPng(svg))).toEqual({ width: 1200, height: 630 });
  });

  it('share picture is 1080 x 1920 with the QR, link and band, inside its budget', async () => {
    const svg = await shareSvg(spec, URL);
    expect(svg).toContain('staging.example/s/WAV4-F6TT');
    expect(svg).toContain(SEAL_IMAGE_COPY.shareBand);
    expect(svg).toMatch(/<svg x="380" y="1200" width="320" height="320"/);
    const png = renderPng(svg);
    expect(pngSize(png)).toEqual({ width: 1080, height: 1920 });
    expect(png.length).toBeLessThan(SHARE_MAX_BYTES);
  });

  it('every picture says it is a picture only', async () => {
    expect(previewSvg(spec, URL)).toContain('Picture only');
    expect(await shareSvg(spec, URL)).toContain('Picture only');
  });

  it('escapes the link it prints', () => {
    expect(previewSvg(spec, 'https://x.example/s/<b>&')).toContain('x.example/s/&lt;b&gt;&amp;');
  });

  it('copy says seal, never token / chip / NFT, and has no em dashes', () => {
    const all = Object.values(SEAL_IMAGE_COPY).join(' ');
    expect(all).not.toMatch(/token|chip|nft|mint|wallet/i);
    expect(all).not.toContain('—');
  });
});

describe('outlinedSealSvg (for the public page)', () => {
  const svg = outlinedSealSvg(spec, 120);

  it('turns text into outlines and loads nothing', () => {
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toMatch(/<text|<image|<script|href="http|style=/);
  });

  it('keeps the muted filter and the pattern clip', () => {
    expect(svg).toContain('<filter');
    expect(svg).toContain('clipPath');
  });
});
