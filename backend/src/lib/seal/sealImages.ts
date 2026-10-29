/**
 * S-SEAL1 Ph2b: the pictures of a seal.
 *
 *   - Preview (1200 × 630): what iMessage, WhatsApp and others show for a /s/<code> link.
 *   - Generic (1200 × 630): the same frame with no code, for unknown and inactive seals.
 *   - Share (1080 × 1920): the owner's share picture, with a QR code back to the seal page.
 *
 * Every picture says it is a picture: only a tap checks a seal (DR-22). All drawn from one SVG
 * per layout and rendered with resvg using fonts bundled in backend/assets/fonts (OFL).
 */
import path from 'node:path';
import { Resvg, type ResvgRenderOptions } from '@resvg/resvg-js';
import QRCode from 'qrcode';
import { displaySealCode } from '../nfc/sealCode';
import { sealSvg } from './sealSvg';
import type { SealSpec } from './sealSpec';

const FONT_DIR = path.resolve(__dirname, '../../../assets/fonts');

const RENDER_OPTIONS: ResvgRenderOptions = {
  font: {
    loadSystemFonts: false,
    fontFiles: [
      'PlusJakartaSans-ExtraBold.ttf',
      'PlusJakartaSans-SemiBold.ttf',
      'IBMPlexMono-Bold.ttf',
      'IBMPlexMono-SemiBold.ttf',
    ].map((f) => path.join(FONT_DIR, f)),
    defaultFontFamily: 'Plus Jakarta Sans',
  },
  shapeRendering: 2,
  textRendering: 1,
  imageRendering: 0,
};

/** Wording on every picture (Brand Voice: short, no em dashes; seal, never token or chip). */
export const SEAL_IMAGE_COPY = {
  brand: 'AUTHENTIC MATERIALS',
  seal: 'Seal',
  pictureOnly: 'Picture only · tap the seal to check',
  genericTitle: 'Authentic Materials seal',
  genericBody: 'Tap the seal with your phone to check it.',
  shareBand: 'Picture only. Tap the seal to check it.',
} as const;

const xml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "https://host/s/XXXX-XXXX" without the scheme, for printing. */
const printableLink = (url: string): string => url.replace(/^https?:\/\//, '');

const background = (w: number, h: number, glowX: number, glowY: number, glowR: number): string =>
  [
    '<defs>',
    '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b0b12"/><stop offset="1" stop-color="#1a1a24"/></linearGradient>',
    `<radialGradient id="glow" cx="${glowX}" cy="${glowY}" r="${glowR}" gradientUnits="userSpaceOnUse">`,
    '<stop offset="0" stop-color="#7c3aed" stop-opacity=".38"/><stop offset="1" stop-color="#7c3aed" stop-opacity="0"/>',
    '</radialGradient>',
    '<linearGradient id="band" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#3b82f6"/></linearGradient>',
    '</defs>',
    `<rect width="${w}" height="${h}" fill="url(#bg)"/>`,
    `<rect width="${w}" height="${h}" fill="url(#glow)"/>`,
  ].join('');

/** The 1200 × 630 link preview. `spec` null draws the generic picture (no code). */
export const previewSvg = (spec: SealSpec | null, pageUrl: string | null): string => {
  const code = spec ? displaySealCode(spec.code) : null;
  const left = 600;
  const text = code
    ? [
        `<text x="${left}" y="196" font-family="Plus Jakarta Sans" font-weight="800" font-size="26" letter-spacing="5" fill="#c4b5fd">${SEAL_IMAGE_COPY.brand}</text>`,
        `<text x="${left}" y="262" font-family="Plus Jakarta Sans" font-weight="600" font-size="40" fill="#e5e7eb">${SEAL_IMAGE_COPY.seal}</text>`,
        `<text x="${left}" y="356" font-family="IBM Plex Mono" font-weight="700" font-size="84" letter-spacing="4" fill="#ffffff">${code}</text>`,
        `<text x="${left}" y="430" font-family="Plus Jakarta Sans" font-weight="600" font-size="30" fill="#d1d5db">${xml(SEAL_IMAGE_COPY.pictureOnly)}</text>`,
        pageUrl
          ? `<text x="${left}" y="486" font-family="IBM Plex Mono" font-weight="600" font-size="21" fill="#a78bfa">${xml(printableLink(pageUrl))}</text>`
          : '',
      ]
    : [
        `<text x="${left}" y="230" font-family="Plus Jakarta Sans" font-weight="800" font-size="26" letter-spacing="5" fill="#c4b5fd">${SEAL_IMAGE_COPY.brand}</text>`,
        `<text x="${left}" y="320" font-family="Plus Jakarta Sans" font-weight="800" font-size="50" fill="#ffffff">${SEAL_IMAGE_COPY.genericTitle}</text>`,
        `<text x="${left}" y="392" font-family="Plus Jakarta Sans" font-weight="600" font-size="30" fill="#d1d5db">${SEAL_IMAGE_COPY.genericBody}</text>`,
      ];
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">',
    background(1200, 630, 320, 315, 360),
    sealSvg(spec, { idPrefix: 'pv', size: 440, x: 100, y: 95 }),
    ...text,
    '</svg>',
  ].join('');
};

/** The QR code as a nested SVG (dark modules on white, quiet zone included). */
const qrSvg = async (url: string, x: number, y: number, size: number): Promise<string> => {
  const raw = await QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2,
    color: { dark: '#13131aff', light: '#ffffffff' },
  });
  return raw.replace(/^<svg /, `<svg x="${x}" y="${y}" width="${size}" height="${size}" `);
};

/** The 1080 × 1920 share picture: seal, code, QR to the seal page, link, and the "picture only" band. */
export const shareSvg = async (spec: SealSpec, pageUrl: string): Promise<string> => {
  const code = displaySealCode(spec.code);
  if (!code) throw new Error('shareSvg: spec has no valid seal code');
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">',
    background(1080, 1920, 540, 600, 520),
    `<text x="540" y="200" text-anchor="middle" font-family="Plus Jakarta Sans" font-weight="800" font-size="34" letter-spacing="7" fill="#c4b5fd">${SEAL_IMAGE_COPY.brand}</text>`,
    sealSvg(spec, { idPrefix: 'sh', size: 640, x: 220, y: 270 }),
    `<text x="540" y="1040" text-anchor="middle" font-family="Plus Jakarta Sans" font-weight="600" font-size="40" fill="#e5e7eb">${SEAL_IMAGE_COPY.seal}</text>`,
    `<text x="540" y="1130" text-anchor="middle" font-family="IBM Plex Mono" font-weight="700" font-size="96" letter-spacing="5" fill="#ffffff">${code}</text>`,
    '<rect x="370" y="1190" width="340" height="340" rx="24" fill="#ffffff"/>',
    await qrSvg(pageUrl, 380, 1200, 320),
    `<text x="540" y="1600" text-anchor="middle" font-family="IBM Plex Mono" font-weight="600" font-size="30" fill="#a78bfa">${xml(printableLink(pageUrl))}</text>`,
    '<rect x="0" y="1720" width="1080" height="200" fill="url(#band)"/>',
    `<text x="540" y="1835" text-anchor="middle" font-family="Plus Jakarta Sans" font-weight="800" font-size="44" fill="#ffffff">${SEAL_IMAGE_COPY.shareBand}</text>`,
    '</svg>',
  ].join('');
};

/** SVG → PNG with the bundled fonts only (no system fonts, so Mac and Linux draw the same). */
export const renderPng = (svg: string): Buffer => Buffer.from(new Resvg(svg, RENDER_OPTIONS).render().asPng());

/**
 * The seal for the public page: text turned into outlines, so the page needs no font files
 * and its Content-Security-Policy can block every fetch.
 */
export const outlinedSealSvg = (spec: SealSpec | null, size: number): string =>
  new Resvg(sealSvg(spec, { idPrefix: 'pg', size }), RENDER_OPTIONS)
    .toString()
    .replace(/^<\?xml[^>]*>\s*/, '');

export const PREVIEW_MAX_BYTES = 300 * 1024;
export const SHARE_MAX_BYTES = 1024 * 1024;
