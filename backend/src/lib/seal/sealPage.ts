/**
 * S-SEAL1 Ph2b: the public seal page `/s/<XXXX-XXXX>` as server HTML.
 *
 * Link previewers run no JavaScript, so the page is plain HTML with its Open Graph tags, inline CSS
 * (allowed by hash) and no script at all. It shows the still Sealed seal, its code, the reliance
 * sentence and only what the verify page shows (public_tag_provenance: the owner's disclosure
 * choices). Never an owner, prior owner, tag id, serial, UID, chip name or Ownership ID.
 *
 * Unknown codes and seals on hold, released or retired all get the same "can't show" page: same body,
 * same status (200, because the CloudFront distribution rewrites every 404 to the app), noindex.
 */
import { createHash } from 'node:crypto';

/** Wording (Brand Voice: warm, short, no em dashes; seal, never token or chip). P5 sentence is Boss-approved for staging. */
export const SEAL_PAGE_COPY = {
  brand: 'Authentic Materials',
  reliance: "This code names a seal. It doesn't prove the item in front of you. Tap the seal.",
  howTo: 'To check a seal, hold your phone near it. Your phone opens the check on its own.',
  description: 'This code names an Authentic Materials seal. Only a tap on the seal checks it.',
  storyHeading: 'The story',
  noStory: 'The owner has not shared origin details for this seal.',
  statusActive: 'Sealed. This seal has an owner on record.',
  statusUnclaimed: 'Sealed. This seal has not been claimed yet.',
  genericTitle: 'Authentic Materials seal',
  genericHeading: "We can't show this seal.",
  genericBody: 'The code may be mistyped, or the seal is no longer active. To check a seal, tap it with your phone.',
  home: 'Authentic Materials home',
  video: 'Watch the origin video',
} as const;

export type SealPageStory = {
  creatorName: string | null;
  originLocation: string | null;
  originDate: string | null;
  claimDate: string | null;
  originVideoUrl: string | null;
};

export type SealPageModel =
  | {
      kind: 'seal';
      displayCode: string;
      lifecycle: 'ENROLLED' | 'ACTIVE';
      /** Outlined seal SVG (no <text>, no external references). */
      sealSvg: string;
      story: SealPageStory;
      pageUrl: string;
      imageUrl: string;
      noindex: boolean;
    }
  | { kind: 'generic'; imageUrl: string; homeUrl: string };

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const STYLE = [
  ':root{color-scheme:dark}',
  '*{box-sizing:border-box}',
  'body{margin:0;min-height:100vh;background:#070709;color:#fff;font-family:"Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.5;padding:2.5rem 1rem}',
  'main{max-width:42rem;margin:0 auto;display:grid;gap:1.5rem}',
  '.card{border-radius:1.75rem;border:1px solid rgb(255 255 255 / .10);background:#20202c;padding:2rem}',
  '.verdict{display:flex;align-items:center;gap:1.25rem;flex-wrap:wrap}',
  '.seal{width:120px;height:120px;flex:none}',
  '.seal svg{width:100%;height:100%;display:block}',
  '.kicker{margin:0 0 .25rem;font-size:.875rem;font-weight:700;letter-spacing:.02em;color:#d1d5db}',
  'h1{margin:0;font-size:1.5rem;line-height:2rem;font-weight:800}',
  '.code{font-family:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:600;letter-spacing:.08em}',
  'p{margin:1rem 0 0;color:#d1d5db}',
  '.reliance{color:#fff;font-weight:600}',
  'h2{margin:0 0 1rem;font-size:1.125rem;font-weight:700}',
  'dl{display:grid;grid-template-columns:1fr;gap:.25rem 1rem;margin:0;font-size:.875rem}',
  '@media (min-width:40rem){dl{grid-template-columns:10rem 1fr}}',
  'dt{color:#9ca3af}',
  'dd{margin:0 0 .5rem;color:#fff}',
  'a{color:#c4b5fd;text-decoration:underline}',
  'a:hover{color:#ede9fe}',
  'a:focus-visible{outline:2px solid #a78bfa;outline-offset:3px;border-radius:4px}',
  'footer{text-align:center;font-size:.875rem;color:#9ca3af}',
  '.flush{margin:0}',
  '.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}',
].join('');

const STYLE_HASH = `'sha256-${createHash('sha256').update(STYLE).digest('base64')}'`;

/** Strict CSP: nothing loads, no script runs, only the one inline style block is allowed. */
export const SEAL_PAGE_CSP = `default-src 'none'; style-src ${STYLE_HASH}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

const formatDate = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
};

const httpsOnly = (raw: string | null): string | null => {
  if (!raw) return null;
  try {
    return new URL(raw).protocol === 'https:' ? raw : null;
  } catch {
    return null;
  }
};

const storyRows = (story: SealPageStory): Array<[string, string]> => {
  const rows: Array<[string, string]> = [];
  if (story.creatorName) rows.push(['Creator', esc(story.creatorName)]);
  if (story.originLocation) rows.push(['Origin', esc(story.originLocation)]);
  const originDate = formatDate(story.originDate);
  if (originDate) rows.push(['Origin date', esc(originDate)]);
  const claimDate = formatDate(story.claimDate);
  if (claimDate) rows.push(['Claimed', esc(claimDate)]);
  const video = httpsOnly(story.originVideoUrl);
  if (video) {
    rows.push(['Origin video', `<a href="${esc(video)}" rel="noopener noreferrer nofollow" target="_blank">${SEAL_PAGE_COPY.video}<span class="sr-only"> (opens in a new tab)</span></a>`]);
  }
  return rows;
};

const head = (o: { title: string; description: string; imageUrl: string; pageUrl?: string; noindex: boolean }): string =>
  [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(o.title)}</title>`,
    `<meta name="description" content="${esc(o.description)}">`,
    o.noindex ? '<meta name="robots" content="noindex">' : '',
    o.pageUrl ? `<link rel="canonical" href="${esc(o.pageUrl)}">` : '',
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Authentic Materials">',
    `<meta property="og:title" content="${esc(o.title)}">`,
    `<meta property="og:description" content="${esc(o.description)}">`,
    o.pageUrl ? `<meta property="og:url" content="${esc(o.pageUrl)}">` : '',
    `<meta property="og:image" content="${esc(o.imageUrl)}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="${esc(o.title)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(o.title)}">`,
    `<meta name="twitter:description" content="${esc(o.description)}">`,
    `<meta name="twitter:image" content="${esc(o.imageUrl)}">`,
    `<style>${STYLE}</style>`,
  ].join('');

export const renderSealPage = (m: SealPageModel): string => {
  if (m.kind === 'generic') {
    return [
      '<!doctype html><html lang="en"><head>',
      head({ title: SEAL_PAGE_COPY.genericTitle, description: SEAL_PAGE_COPY.description, imageUrl: m.imageUrl, noindex: true }),
      '</head><body><main>',
      '<section class="card">',
      `<h1>${SEAL_PAGE_COPY.genericHeading}</h1>`,
      `<p>${esc(SEAL_PAGE_COPY.genericBody)}</p>`,
      '</section>',
      `<footer><a href="${esc(m.homeUrl)}">${SEAL_PAGE_COPY.home}</a></footer>`,
      '</main></body></html>',
    ].join('');
  }

  const title = `Seal ${m.displayCode} · ${SEAL_PAGE_COPY.brand}`;
  const rows = storyRows(m.story);
  const status = m.lifecycle === 'ACTIVE' ? SEAL_PAGE_COPY.statusActive : SEAL_PAGE_COPY.statusUnclaimed;
  const homeUrl = new URL('/', m.pageUrl).toString();
  return [
    '<!doctype html><html lang="en"><head>',
    head({ title, description: SEAL_PAGE_COPY.description, imageUrl: m.imageUrl, pageUrl: m.pageUrl, noindex: m.noindex }),
    '</head><body><main>',
    '<section class="card">',
    '<div class="verdict">',
    `<div class="seal" role="img" aria-label="Sealed, seal code ${m.displayCode}">${m.sealSvg}</div>`,
    '<div>',
    `<p class="kicker">${esc(status)}</p>`,
    `<h1>Seal <span class="code">${m.displayCode}</span></h1>`,
    '</div>',
    '</div>',
    `<p class="reliance">${esc(SEAL_PAGE_COPY.reliance)}</p>`,
    `<p>${esc(SEAL_PAGE_COPY.howTo)}</p>`,
    '</section>',
    '<section class="card" aria-labelledby="story">',
    `<h2 id="story">${SEAL_PAGE_COPY.storyHeading}</h2>`,
    rows.length === 0
      ? `<p class="flush">${SEAL_PAGE_COPY.noStory}</p>`
      : `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`,
    '</section>',
    `<footer><a href="${esc(homeUrl)}">${SEAL_PAGE_COPY.home}</a></footer>`,
    '</main></body></html>',
  ].join('');
};
