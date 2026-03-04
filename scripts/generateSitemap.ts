/**
 * Sitemap generation stub.
 *
 * Fetches active listings and NFC verification token names from Supabase,
 * then generates a sitemap.xml and writes it to frontend/public/.
 *
 * Usage (when API keys and DB credentials are available):
 *   npx ts-node scripts/generateSitemap.ts
 *   # or add to CI/CD pipeline to regenerate on deploy
 *
 * TODO: Activate when Supabase credentials are available in the build environment.
 *
 * @module Module 18 — Launch Prep
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';
import { join } from 'path';

const SITE_URL = process.env.VITE_APP_URL ?? 'https://auctionx.com';
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

/**
 * Fetches active listing slugs/IDs from Supabase.
 *
 * @returns Array of listing IDs for active auctions
 */
async function fetchActiveListingIds(): Promise<string[]> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data, error } = await supabase
    .from('listings')
    .select('id')
    .eq('status', 'ACTIVE');

  if (error) {
    console.error('Failed to fetch listings:', error.message);
    return [];
  }

  return (data ?? []).map((row) => row.id as string);
}

/**
 * Fetches active NFC token names from Supabase.
 *
 * @returns Array of token names for public verification pages
 */
async function fetchVerificationTokens(): Promise<string[]> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data, error } = await supabase
    .from('item_verifications')
    .select('token_name')
    .eq('status', 'ACTIVE');

  if (error) {
    console.error('Failed to fetch verification tokens:', error.message);
    return [];
  }

  return (data ?? []).map((row) => row.token_name as string);
}

/**
 * Generates XML entries for a list of URLs.
 *
 * @param urls        - Array of full URLs to include
 * @param changefreq  - How often the page is likely to change
 * @param priority    - Priority of this URL relative to other URLs (0.0–1.0)
 * @returns XML string fragments
 */
function buildUrlEntries(
  urls: string[],
  changefreq: string,
  priority: string
): string {
  return urls
    .map(
      (url) => `
  <url>
    <loc>${url}</loc>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`
    )
    .join('');
}

/**
 * Main entry point. Generates sitemap.xml and writes to frontend/public/.
 */
async function generateSitemap(): Promise<void> {
  const staticRoutes = ['/', '/browse', '/search'];

  const listingIds = await fetchActiveListingIds();
  const listingUrls = listingIds.map((id) => `${SITE_URL}/listings/${id}`);

  const tokenNames = await fetchVerificationTokens();
  const verifyUrls = tokenNames.map((token) => `${SITE_URL}/verify/${token}`);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${buildUrlEntries(staticRoutes.map((r) => `${SITE_URL}${r}`), 'daily', '0.8')}
${buildUrlEntries(listingUrls, 'hourly', '0.9')}
${buildUrlEntries(verifyUrls, 'weekly', '0.6')}
</urlset>`;

  const outPath = join(__dirname, '..', 'frontend', 'public', 'sitemap.xml');
  writeFileSync(outPath, xml, 'utf-8');
  console.log(`✅ Sitemap written to ${outPath} (${listingUrls.length} listings, ${verifyUrls.length} verify pages)`);
}

generateSitemap().catch((err) => {
  console.error('Sitemap generation failed:', err);
  process.exit(1);
});
