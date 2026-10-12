// One-off: render the PNG icons from the AM mark. Run from frontend/: node scripts/make-icons.mjs
import { chromium } from '@playwright/test';
const PATH = 'M51.63 64.00L42.84 64.00L42.72 55.53L29.76 55.53L24.22 64.00L16.12 64.00L43.55 24.00L55.64 24.00L63.80 50.10L63.90 50.10L72.11 24.00L83.88 24.00L83.88 64.00L76.07 64.00L76.07 33.32L75.97 33.32L66.66 64.00L60.70 64.00L51.73 33.32L51.63 33.32L51.63 64.00ZM42.59 35.64L34.49 48.07L42.65 48.07L42.59 35.64Z';
// rounded: browser tab icons (transparent corners). square: phone home screens, which round the corners themselves.
const svg = (size, rounded) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#3b82f6"/></linearGradient></defs>
<rect width="64" height="64" rx="${rounded ? 8 : 0}" fill="#070709"/>
<path transform="translate(-9.5 -1.83) scale(0.767)" fill-rule="evenodd" fill="url(#g)" d="${PATH}"/></svg>`;
const ICONS = [
  ['favicon-16x16.png', 16, true], ['favicon-32x32.png', 32, true],
  ['apple-touch-icon.png', 180, false], ['icon-192.png', 192, false], ['icon-512.png', 512, false],
];
const browser = await chromium.launch();
for (const [name, size, rounded] of ICONS) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;background:transparent">${svg(size, rounded)}</body>`);
  await page.screenshot({ path: `public/${name}`, omitBackground: true });
  await page.close();
}
await browser.close();
