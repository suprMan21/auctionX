# AuctionX — Lessons Learned

---

## Module 06: Browse & Search — 2026-03-01

### What Worked
- Supabase join query pattern for listings + auctions + media is clean and reusable
- Building ListingCard as a shared component paid off immediately (used in 2 pages)
- Basic ilike search is surprisingly functional for early-stage — good enough to ship
- `useSearchParams` from react-router-dom makes URL-synced search state trivial

### Patterns Discovered
- **Listing query pattern:** `.select('id, title, auctions(id, current_price_cents, end_time, status), listing_media(url, type, sort_order)')` — use this everywhere listings need price/image data
- **Price formatting:** Always use `formatPrice()` from `lib/utils/formatPrice.ts` — never manually divide by 100
- **Time display:** `timeRemaining()` for static display, `useCountdown` hook (Module 08) for live countdown
- **Public routes:** Browse and search don't need auth — bidding is gated at the auction detail level
- **Category slugs:** The `categories` table has a real `slug` column. Filter server-side with `.eq('slug', categorySlug)` — no client-side slug generation needed.

### Gotchas
- Supabase joins return arrays even for 1:1 relationships — always access as `listing.auctions?.[0]` not `listing.auction`
- The `.ilike()` filter is case-insensitive but doesn't handle partial word matching well ("jersey" won't match "New Jersey Nets jersey" if user types "net")
- `as never` cast required on `.order('sort_order')` for categories because sort_order is not in the generated TypeScript select type

### Time Estimate vs Actual
- Estimated: ~15 minutes (Claude Code session)
- Actual: 3m 30s
- Delta: Simpler than expected — no backend work needed, just frontend pages + Supabase queries
