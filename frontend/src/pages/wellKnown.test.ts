import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * S-MOB1: the two association files that let the Creator app use website
 * passkeys and open from the website's "Open the app" link. Vite copies
 * `public/` into both builds; scripts/deploy-frontend.sh uploads the Apple file
 * as application/json (it has no file extension) and checks both after deploy.
 *
 * Before the production launch (S-LAUNCH1 / S-MOB1 M4): add the Play App
 * Signing and upload key fingerprints, and drop the local debug key.
 */

const WELL_KNOWN = resolve(__dirname, '../../public/.well-known');
const APP_ID = 'F5F52345D2.com.authenticmaterials.tags';
const PACKAGE = 'com.authenticmaterials.tags';

const readJson = (name: string): unknown => JSON.parse(readFileSync(resolve(WELL_KNOWN, name), 'utf8'));

describe('apple-app-site-association', () => {
  const aasa = readJson('apple-app-site-association') as {
    applinks: { details: { appIDs: string[]; components: { '/': string }[] }[] };
    webcredentials: { apps: string[] };
  };

  it('lets the app use passkeys from this domain', () => {
    expect(aasa.webcredentials.apps).toEqual([APP_ID]);
  });

  it('opens the app for /app/open only', () => {
    expect(aasa.applinks.details).toHaveLength(1);
    expect(aasa.applinks.details[0].appIDs).toEqual([APP_ID]);
    const paths = aasa.applinks.details[0].components.map((c) => c['/']);
    expect(paths.every((p) => p === '/app/open' || p === '/app/open/')).toBe(true);
  });
});

describe('assetlinks.json', () => {
  const links = readJson('assetlinks.json') as {
    relation: string[];
    target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
  }[];

  it('grants sign-in credentials and verified links to our app only', () => {
    expect(links).toHaveLength(1);
    expect(links[0].relation.sort()).toEqual([
      'delegate_permission/common.get_login_creds',
      'delegate_permission/common.handle_all_urls',
    ]);
    expect(links[0].target).toMatchObject({ namespace: 'android_app', package_name: PACKAGE });
  });

  it('lists well-formed SHA-256 fingerprints', () => {
    const prints = links[0].target.sha256_cert_fingerprints;
    expect(prints.length).toBeGreaterThan(0);
    for (const p of prints) expect(p).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });
});
