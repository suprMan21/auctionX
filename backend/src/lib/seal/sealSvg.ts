/**
 * S-SEAL1 Ph2b: the still Sealed seal as an SVG string, drawn by the server for the public seal
 * page and the preview / share images. Same drawing as the website's SealBadge in its `sealed`
 * state (white still rings, muted colours, no sheen), built from the same geometry and spec.
 *
 * Never draws the Verified look: a picture or a link is not a tap.
 */
import { displaySealCode } from '../nfc/sealCode';
import { sealColors } from './colorPairs';
import { SEAL_GEOMETRY as G } from './geometry';
import type { SealSpec } from './sealSpec';

/** Only M / l / Z path commands are ever drawn (same rule as readStoredSealSpec and the website). */
const SEAL_PATH = /^M[-\d. l]+Z$/;

export type SealSvgOptions = {
  /** Element id prefix, so two seals can share one document. Letters, digits, '-' only. */
  idPrefix?: string;
  /** Outer width / height attributes (the drawing is always the 120 × 120 box). */
  size?: number;
  /** Placement when nested inside a bigger SVG. */
  x?: number;
  y?: number;
};

/**
 * The seal for `spec`, or the generic seal (no pattern, no code) when `spec` is null.
 * The generic seal is what unknown, on hold, released and retired codes get.
 */
export const sealSvg = (spec: SealSpec | null, opts: SealSvgOptions = {}): string => {
  const p = (opts.idPrefix ?? 'seal').replace(/[^a-zA-Z0-9-]/g, '');
  const code = spec ? displaySealCode(spec.code) : null;
  const [outer, inner] = spec?.v === 1 ? spec.pattern.paths : [];
  const drawPattern = typeof outer === 'string' && SEAL_PATH.test(outer) && typeof inner === 'string' && SEAL_PATH.test(inner);
  const [c0, c1, c2] = sealColors(spec?.colors);
  const size = opts.size ?? G.viewBox;
  const place = opts.x !== undefined || opts.y !== undefined ? ` x="${opts.x ?? 0}" y="${opts.y ?? 0}"` : '';

  return [
    `<svg xmlns="http://www.w3.org/2000/svg"${place} width="${size}" height="${size}" viewBox="0 0 ${G.viewBox} ${G.viewBox}">`,
    '<defs>',
    `<linearGradient id="${p}-grad" x1="0" y1="0" x2="1" y2="1">`,
    `<stop offset="0" stop-color="${c0}"/><stop offset=".55" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>`,
    '</linearGradient>',
    `<path id="${p}-ring" d="${G.ringPath}"/>`,
    drawPattern ? `<clipPath id="${p}-clip"><circle cx="60" cy="60" r="${G.patternClipR}"/></clipPath>` : '',
    // The website's Sealed look is CSS `saturate(.6) brightness(.82)`; the same as an SVG filter.
    `<filter id="${p}-muted" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">`,
    '<feColorMatrix type="saturate" values=".6"/>',
    '<feComponentTransfer><feFuncR type="linear" slope=".82"/><feFuncG type="linear" slope=".82"/><feFuncB type="linear" slope=".82"/></feComponentTransfer>',
    '</filter>',
    '</defs>',
    `<g filter="url(#${p}-muted)">`,
    `<path d="${G.scallop}" fill="url(#${p}-grad)"/>`,
    drawPattern
      ? `<g clip-path="url(#${p}-clip)" fill="none" stroke="#ffffff" stroke-width=".35" stroke-linejoin="round">` +
        `<path d="${outer}" stroke-opacity=".2"/><path d="${inner}" stroke-opacity=".14"/></g>`
      : '',
    `<circle cx="60" cy="60" r="${G.innerCircleR}" fill="none" stroke="#ffffff" stroke-opacity=".45" stroke-width="1"/>`,
    '<text fill="#ffffff" font-family="Plus Jakarta Sans" font-size="8" font-weight="800" letter-spacing="1.6">',
    `<textPath href="#${p}-ring" textLength="248" lengthAdjust="spacing">GENUINE · SEALED · AUTHENTIC MATERIALS ·</textPath>`,
    '</text>',
    `<path fill-rule="evenodd" fill="#ffffff" transform="${G.amMarkTransform}" d="${G.amMark}"/>`,
    code
      ? `<text x="60" y="80" text-anchor="middle" fill="#ffffff" font-family="IBM Plex Mono" font-size="6.6" font-weight="700" letter-spacing=".6">${code}</text>`
      : '',
    '</g>',
    '</svg>',
  ].join('');
};
