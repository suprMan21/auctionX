# AuctionX — TODO Tracker

Last updated: 2026-03-01

---

## Module 06: Browse & Search

- [ ] **TODO:** Add pagination to browse and search results
  - Context: Currently hardcoded `.limit(24)` for browse and `.limit(48)` for search
  - Priority: MEDIUM
  - Depends on: Standalone

- [ ] **TODO:** Replace ilike search with full-text search
  - Context: Basic ilike on title/description is slow and imprecise at scale
  - Priority: HIGH
  - Depends on: Module 14 (Enhanced Search)

- [ ] **TODO:** Add loading skeletons to BrowsePage and SearchResultsPage
  - Context: No loading state during Supabase fetch — text placeholder only, page appears partially empty briefly
  - Priority: LOW
  - Depends on: Standalone

- [ ] **TODO:** Move sort to database level for ending soonest / price sorts
  - Context: Currently sorting client-side after fetch. Works for small datasets but won't scale.
  - Priority: MEDIUM
  - Depends on: Module 14 (Enhanced Search)
