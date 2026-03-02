/**
 * formatPrice — Converts cents to a localized currency string
 *
 * @param cents - Price in cents (e.g., 12500 = $125.00)
 * @param currency - ISO currency code, defaults to 'CAD'
 * @returns Formatted string using Intl.NumberFormat with en-CA locale (e.g., "$125.00")
 *
 * Used across: ListingCard, BrowsePage, SearchResultsPage, Dashboard, MyListings
 *
 * @module Module 06 — Browse & Search
 */
export function formatPrice(cents: number, currency: 'CAD' | 'USD' = 'CAD'): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(cents / 100);
}
