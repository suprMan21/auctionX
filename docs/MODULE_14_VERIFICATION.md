# Module 14 — Enhanced Search: Verification

## Build Status

| Check | Status |
|-------|--------|
| Frontend TypeScript (`npx tsc --noEmit`) | ✅ 0 errors |
| Backend TypeScript (`npx tsc --noEmit`) | ✅ 0 errors |
| Production build (`npm run build`) | ✅ PASS |

---

## Files Created

| File | Description |
|------|-------------|
| `supabase/migrations/20260302000001_full_text_search.sql` | pg_trgm extension, search_vector column, GIN index, auto-update trigger, saved_searches table + RLS |
| `backend/src/controllers/searchController.ts` | searchListings (public), createSavedSearch, getSavedSearches, deleteSavedSearch |
| `backend/src/routes/search.ts` | Route bindings for /api/v1/search |
| `frontend/src/pages/SavedSearchesPage.tsx` | Authenticated page to list/run/delete saved searches |

## Files Modified

| File | Change |
|------|--------|
| `backend/src/server.ts` | Mounted `/api/v1/search` route |
| `frontend/src/lib/api.ts` | Added SearchParams, SearchResponse, SavedSearch types + search/saved-search methods |
| `frontend/src/pages/SearchResultsPage.tsx` | Full rewrite: filter sidebar, DB search, server-side pagination, save search |
| `frontend/src/pages/BrowsePage.tsx` | Replaced direct Supabase fetch with api.search(); added pagination controls |
| `frontend/src/App.tsx` | Added `/saved-searches` protected route |

---

## Route Inventory

### Backend
| Method | Route | Auth | Handler |
|--------|-------|------|---------|
| GET | `/api/v1/search` | Public | `searchListings` |
| POST | `/api/v1/search/saved` | Required | `createSavedSearch` |
| GET | `/api/v1/search/saved` | Required | `getSavedSearches` |
| DELETE | `/api/v1/search/saved/:id` | Required | `deleteSavedSearch` |

### Frontend
| Path | Auth | Component |
|------|------|-----------|
| `/search` | Public | `SearchResultsPage` |
| `/browse`, `/browse/:categorySlug` | Public | `BrowsePage` (with pagination) |
| `/saved-searches` | Protected | `SavedSearchesPage` |

---

## Search Query Params

| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Full-text search (websearch syntax: "jordan +rookie -reprint") |
| `category` | string | Category slug |
| `minPrice` | integer | Minimum price in **cents** |
| `maxPrice` | integer | Maximum price in **cents** |
| `condition` | string | Listing condition |
| `verifiedOnly` | 'true' | Inner-join on item_verifications |
| `sort` | enum | relevance \| ending_soonest \| price_asc \| price_desc \| newest |
| `page` | integer | 1-indexed, default 1 |
| `limit` | integer | Per-page count, default 24, max 48 |

---

## Manual Test Checklist

- [ ] `GET /api/v1/search?q=jersey&limit=5` → returns results array with total/page/totalPages
- [ ] `GET /api/v1/search?q=jersey&sort=price_asc` → results ordered by current_price_cents ascending
- [ ] `GET /api/v1/search?verifiedOnly=true` → only listings with item_verifications appear
- [ ] `GET /api/v1/search?category=sports&page=2` → page 2 of category results
- [ ] `/search?q=jersey` → results load, count displayed
- [ ] Apply category + price filter → URL updates, results re-fetch
- [ ] Toggle "Verified Only" → URL updated with verifiedOnly=true
- [ ] Sort select → URL updates, results re-ordered
- [ ] Pagination Previous/Next visible when totalPages > 1
- [ ] Log in → "Save This Search" button appears in sidebar
- [ ] Save a search → success message appears
- [ ] `/saved-searches` → saved search listed with name, query, filter chips
- [ ] "Run" on saved search → navigates to `/search` with filters applied
- [ ] "Delete" → inline confirmation; "Confirm" removes row
- [ ] `/browse/sports` → pagination controls appear when > 24 results

---

## Known Gaps

1. **`search_vector` not yet in `database.types.ts`** — `.textSearch('search_vector')` uses `as never` type assertion until migration is applied and types are regenerated.
2. **Migration not yet pushed** — `npx supabase db push` required; types must be regenerated afterward.
3. **ts_rank not applied on relevance sort** — textSearch results are returned in relevance order naturally by PostgREST, but explicit `ts_rank` ordering via raw SQL is not implemented (see `docs/TODO.md`).
4. **`notify_new_results` stored but no worker** — the flag is persisted; email/push notification delivery is not implemented.
5. **BrowsePage category grid** — still fetches all categories in one query; acceptable at current scale.
