/**
 * SearchResultsPage — Full-text search with filters, sort, pagination, and saved searches
 *
 * Route: /search  (params: q, category, minPrice, maxPrice, condition, verifiedOnly, sort, page)
 *
 * All UI state is synced to URL search params so results are bookmarkable/shareable.
 * Data fetching: calls GET /api/v1/search (DB-level full-text + filters + pagination).
 *
 * Features:
 * - PostgreSQL full-text search via websearch syntax (Module 14)
 * - Filter sidebar: category, price range, condition, verified-only
 * - DB-level sort: relevance, ending soonest, price asc/desc, newest
 * - Server-side pagination with Previous/Next controls
 * - "Save Search" button for authenticated users (opens inline form)
 *
 * @module Module 14 — Enhanced Search
 */
import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { ListingCard } from '@/components/listings/ListingCard';
import { supabase } from '@/features/auth/lib/supabase';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { api, type SearchResult, type SearchResponse, type SavedSearchFilters } from '@/lib/api';

type SortOption = 'relevance' | 'ending_soonest' | 'price_asc' | 'price_desc' | 'newest';

const SORT_LABELS: Record<SortOption, string> = {
  relevance: 'Relevance',
  ending_soonest: 'Ending Soonest',
  price_asc: 'Price ↑',
  price_desc: 'Price ↓',
  newest: 'Newest',
};

const CONDITIONS = ['New', 'Like New', 'Good', 'Fair', 'Poor'];

interface Category {
  id: string;
  name: string;
  slug: string;
}

// ── SaveSearch modal ─────────────────────────────────────────────────────────

interface SaveSearchFormProps {
  query: string;
  filters: SavedSearchFilters;
  onSaved: () => void;
  onCancel: () => void;
}

function SaveSearchForm({ query, filters, onSaved, onCancel }: SaveSearchFormProps) {
  const [name, setName] = useState('');
  const [notify, setNotify] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Please enter a name'); return; }
    setSaving(true);
    setError(null);
    try {
      await api.createSavedSearch({ name: name.trim(), query, filters, notifyNewResults: notify });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save search');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="glass rounded-2xl p-5 border border-white/10 mt-4"
      aria-label="Save this search"
    >
      <h3 className="text-white font-semibold mb-3">Save this search</h3>
      {error && <p className="text-red-400 text-sm mb-2">{error}</p>}
      <label htmlFor="save-search-name" className="block text-sm text-gray-400 mb-1">
        Search name
      </label>
      <input
        id="save-search-name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Jordan rookie cards"
        className="w-full h-10 px-3 rounded-xl bg-white/5 border border-white/10 text-white
                   placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 mb-3"
      />
      <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer mb-4">
        <input
          type="checkbox"
          checked={notify}
          onChange={(e) => setNotify(e.target.checked)}
          className="rounded border-white/20 bg-white/5 text-primary-500 focus:ring-primary-500"
        />
        Notify me when new results match
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 h-9 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-sm font-semibold
                     transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 h-9 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-sm font-semibold
                     transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function SearchResultsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { session } = useAuth();

  // ── URL-synced state ─────────────────────────────────────────────────────
  const query = searchParams.get('q') ?? '';
  const categoryParam = searchParams.get('category') ?? '';
  const minPriceParam = searchParams.get('minPrice') ?? '';
  const maxPriceParam = searchParams.get('maxPrice') ?? '';
  const conditionParam = searchParams.get('condition') ?? '';
  const verifiedOnlyParam = searchParams.get('verifiedOnly') === 'true';
  const sortParam = (searchParams.get('sort') ?? 'relevance') as SortOption;
  const pageParam = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);

  // ── Local filter UI state (applied to URL on "Apply") ───────────────────
  const [inputValue, setInputValue] = useState(query);
  const [filterCategory, setFilterCategory] = useState(categoryParam);
  const [filterMinPrice, setFilterMinPrice] = useState(minPriceParam);
  const [filterMaxPrice, setFilterMaxPrice] = useState(maxPriceParam);
  const [filterCondition, setFilterCondition] = useState(conditionParam);
  const [filterVerifiedOnly, setFilterVerifiedOnly] = useState(verifiedOnlyParam);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // ── Data state ──────────────────────────────────────────────────────────
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);

  // Sync local filter state when URL changes (browser back/forward)
  useEffect(() => {
    setInputValue(query);
    setFilterCategory(categoryParam);
    setFilterMinPrice(minPriceParam);
    setFilterMaxPrice(maxPriceParam);
    setFilterCondition(conditionParam);
    setFilterVerifiedOnly(verifiedOnlyParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()]);

  // Fetch categories for the filter dropdown (small table, fetched once)
  useEffect(() => {
    supabase
      .from('categories')
      .select('id, name, slug')
      .order('sort_order' as never)
      .then(({ data }) => setCategories((data as unknown as Category[]) ?? []));
  }, []);

  // Fetch results whenever URL params change
  const fetchResults = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        q: query || undefined,
        category: categoryParam || undefined,
        minPrice: minPriceParam ? parseInt(minPriceParam, 10) : undefined,
        maxPrice: maxPriceParam ? parseInt(maxPriceParam, 10) : undefined,
        condition: conditionParam || undefined,
        verifiedOnly: verifiedOnlyParam || undefined,
        sort: sortParam !== 'relevance' ? sortParam : undefined,
        page: pageParam,
        limit: 24,
      };
      const response: SearchResponse = await api.search(params);
      setResults(response.results);
      setTotal(response.total);
      setTotalPages(response.totalPages);
    } catch (err) {
      console.error('Search failed:', err);
      setResults([]);
      setTotal(0);
      setTotalPages(0);
    } finally {
      setLoading(false);
    }
  }, [searchParams.toString()]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (trimmed) {
      setSearchParams({ q: trimmed });
    }
  };

  const handleApplyFilters = () => {
    const next: Record<string, string> = {};
    if (query) next['q'] = query;
    if (filterCategory) next['category'] = filterCategory;
    // Prices in URL are in cents
    if (filterMinPrice) next['minPrice'] = filterMinPrice;
    if (filterMaxPrice) next['maxPrice'] = filterMaxPrice;
    if (filterCondition) next['condition'] = filterCondition;
    if (filterVerifiedOnly) next['verifiedOnly'] = 'true';
    if (sortParam !== 'relevance') next['sort'] = sortParam;
    next['page'] = '1'; // reset to page 1 on filter change
    setSearchParams(next);
    setSidebarOpen(false);
  };

  const handleClearFilters = () => {
    setFilterCategory('');
    setFilterMinPrice('');
    setFilterMaxPrice('');
    setFilterCondition('');
    setFilterVerifiedOnly(false);
    const next: Record<string, string> = {};
    if (query) next['q'] = query;
    next['page'] = '1';
    setSearchParams(next);
    setSidebarOpen(false);
  };

  const handleSortChange = (newSort: SortOption) => {
    const next: Record<string, string> = {};
    // Preserve all current params, just update sort and reset page
    searchParams.forEach((v, k) => { next[k] = v; });
    if (newSort === 'relevance') {
      delete next['sort'];
    } else {
      next['sort'] = newSort;
    }
    next['page'] = '1';
    setSearchParams(next);
  };

  const handlePageChange = (newPage: number) => {
    const next: Record<string, string> = {};
    searchParams.forEach((v, k) => { next[k] = v; });
    next['page'] = String(newPage);
    setSearchParams(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Build SavedSearchFilters from current URL state
  const currentFilters: SavedSearchFilters = {
    ...(categoryParam && { category: categoryParam }),
    ...(minPriceParam && { minPrice: parseInt(minPriceParam, 10) }),
    ...(maxPriceParam && { maxPrice: parseInt(maxPriceParam, 10) }),
    ...(conditionParam && { condition: conditionParam }),
    ...(verifiedOnlyParam && { verifiedOnly: true }),
    ...(sortParam !== 'relevance' && { sort: sortParam }),
  };

  const hasActiveFilters = categoryParam || minPriceParam || maxPriceParam || conditionParam || verifiedOnlyParam;

  return (
    <ErrorBoundary>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4
                   bg-primary-500 text-white px-4 py-2 rounded-lg z-50
                   focus:outline-none focus:ring-2 focus:ring-white"
      >
        Skip to main content
      </a>

      <div className="min-h-screen bg-dark-800">
        {/* Search bar */}
        <div className="border-b border-white/10 bg-dark-700/50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <form onSubmit={handleSearchSubmit} role="search" className="flex gap-3 max-w-2xl">
              <label htmlFor="search-input" className="sr-only">Search listings</label>
              <input
                id="search-input"
                type="search"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Search listings…"
                className="flex-1 h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-white
                           placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                autoFocus
              />
              <button
                type="submit"
                className="h-11 px-6 rounded-xl bg-primary-600 hover:bg-primary-500 text-white font-semibold
                           transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
              >
                Search
              </button>
            </form>
          </div>
        </div>

        <main id="main-content" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex gap-8">
            {/* ── Filter sidebar ─────────────────────────────────────────── */}
            <aside
              className={[
                'w-64 flex-shrink-0',
                // Mobile: overlay slide-in; Desktop: always visible
                'hidden lg:block',
                sidebarOpen ? '!block' : '',
              ].join(' ')}
              aria-label="Search filters"
            >
              <div className="glass rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-white font-semibold">Filters</h2>
                  {hasActiveFilters && (
                    <button
                      onClick={handleClearFilters}
                      className="text-xs text-primary-400 hover:text-primary-300 focus:outline-none focus:underline"
                    >
                      Clear All
                    </button>
                  )}
                </div>

                {/* Category */}
                <div className="mb-4">
                  <label htmlFor="filter-category" className="block text-sm text-gray-400 mb-1">Category</label>
                  <select
                    id="filter-category"
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                    className="w-full h-9 px-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm
                               focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">All categories</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.slug}>{cat.name}</option>
                    ))}
                  </select>
                </div>

                {/* Price range — inputs are in dollars, stored/sent as cents */}
                <div className="mb-4">
                  <p className="text-sm text-gray-400 mb-1">Price range</p>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label htmlFor="filter-min" className="sr-only">Minimum price in dollars</label>
                      <input
                        id="filter-min"
                        type="number"
                        min={0}
                        value={filterMinPrice ? String(Math.round(parseInt(filterMinPrice, 10) / 100)) : ''}
                        onChange={(e) => {
                          const dollars = parseFloat(e.target.value);
                          setFilterMinPrice(isNaN(dollars) ? '' : String(Math.round(dollars * 100)));
                        }}
                        placeholder="$ Min"
                        className="w-full h-9 px-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm
                                   placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div className="flex-1">
                      <label htmlFor="filter-max" className="sr-only">Maximum price in dollars</label>
                      <input
                        id="filter-max"
                        type="number"
                        min={0}
                        value={filterMaxPrice ? String(Math.round(parseInt(filterMaxPrice, 10) / 100)) : ''}
                        onChange={(e) => {
                          const dollars = parseFloat(e.target.value);
                          setFilterMaxPrice(isNaN(dollars) ? '' : String(Math.round(dollars * 100)));
                        }}
                        placeholder="$ Max"
                        className="w-full h-9 px-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm
                                   placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Condition */}
                <div className="mb-4">
                  <label htmlFor="filter-condition" className="block text-sm text-gray-400 mb-1">Condition</label>
                  <select
                    id="filter-condition"
                    value={filterCondition}
                    onChange={(e) => setFilterCondition(e.target.value)}
                    className="w-full h-9 px-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm
                               focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">Any condition</option>
                    {CONDITIONS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                {/* Verified only */}
                <div className="mb-5">
                  <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filterVerifiedOnly}
                      onChange={(e) => setFilterVerifiedOnly(e.target.checked)}
                      className="rounded border-white/20 bg-white/5 text-primary-500 focus:ring-primary-500"
                    />
                    Verified items only
                  </label>
                </div>

                <button
                  onClick={handleApplyFilters}
                  className="w-full h-10 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-sm font-semibold
                             transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  Apply Filters
                </button>

                {/* Save search — only shown when logged in */}
                {session && (
                  <div className="mt-4">
                    {saveSuccessMsg ? (
                      <p className="text-emerald-400 text-sm text-center">{saveSuccessMsg}</p>
                    ) : showSaveForm ? (
                      <SaveSearchForm
                        query={query}
                        filters={currentFilters}
                        onSaved={() => {
                          setShowSaveForm(false);
                          setSaveSuccessMsg('Search saved!');
                          setTimeout(() => setSaveSuccessMsg(null), 3000);
                        }}
                        onCancel={() => setShowSaveForm(false)}
                      />
                    ) : (
                      <button
                        onClick={() => setShowSaveForm(true)}
                        className="w-full h-9 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-sm
                                   transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        Save This Search
                      </button>
                    )}
                  </div>
                )}
              </div>
            </aside>

            {/* ── Results ───────────────────────────────────────────────── */}
            <div className="flex-1 min-w-0">
              {/* Results header row */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-3">
                  {/* Mobile filter toggle */}
                  <button
                    onClick={() => setSidebarOpen((v) => !v)}
                    className="lg:hidden flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10
                               text-gray-300 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500"
                    aria-expanded={sidebarOpen}
                    aria-controls="filter-sidebar"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h18M7 8h10M10 12h4" />
                    </svg>
                    Filters
                    {hasActiveFilters && (
                      <span className="w-2 h-2 rounded-full bg-primary-500" aria-label="Active filters" />
                    )}
                  </button>

                  {!loading && (
                    <p data-testid="results-count" className="text-gray-300 text-sm">
                      <span className="text-white font-semibold">{total.toLocaleString()}</span>{' '}
                      {total === 1 ? 'result' : 'results'}
                      {query && (
                        <> for <span className="text-white font-semibold">&lsquo;{query}&rsquo;</span></>
                      )}
                    </p>
                  )}
                </div>

                {/* Sort */}
                <div className="flex items-center gap-2" role="group" aria-label="Sort results">
                  <span className="text-gray-400 text-sm sr-only sm:not-sr-only">Sort:</span>
                  <select
                    data-testid="sort-select"
                    value={sortParam}
                    onChange={(e) => handleSortChange(e.target.value as SortOption)}
                    className="h-9 px-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm
                               focus:outline-none focus:ring-2 focus:ring-primary-500"
                    aria-label="Sort results by"
                  >
                    {(Object.keys(SORT_LABELS) as SortOption[]).map((opt) => (
                      <option key={opt} value={opt}>{SORT_LABELS[opt]}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Content */}
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <p className="text-gray-400">Searching…</p>
                </div>
              ) : results.length === 0 && !query.trim() ? (
                <div className="glass rounded-2xl p-12 text-center">
                  <h2 className="text-2xl font-bold text-white mb-3">Enter a search term</h2>
                  <p className="text-gray-400">Try searching for an athlete, team, or item type.</p>
                </div>
              ) : results.length === 0 ? (
                <div data-testid="empty-state" className="glass rounded-2xl p-12 text-center">
                  <h2 className="text-2xl font-bold text-white mb-3">No results found</h2>
                  <p className="text-gray-400 mb-6">
                    {query
                      ? <>No active listings matched &lsquo;{query}&rsquo;. Try a different search term.</>
                      : 'No listings match the selected filters.'}
                  </p>
                  <button
                    onClick={() => navigate('/browse')}
                    className="inline-flex items-center px-6 py-3 rounded-xl bg-primary-600 hover:bg-primary-500
                               text-white font-semibold transition-colors focus:outline-none focus:ring-2
                               focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
                  >
                    Browse All Listings
                  </button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6">
                    {results.map((listing) => (
                      <ListingCard key={listing.id} listing={listing} />
                    ))}
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <nav
                      aria-label="Search results pages"
                      className="flex items-center justify-center gap-3 mt-10"
                    >
                      <button
                        onClick={() => handlePageChange(pageParam - 1)}
                        disabled={pageParam <= 1}
                        className="px-4 py-2 rounded-xl glass text-sm text-gray-300 hover:text-white
                                   disabled:opacity-40 disabled:cursor-not-allowed transition-colors
                                   focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        ← Previous
                      </button>
                      <span className="text-gray-400 text-sm">
                        Page <span className="text-white font-semibold">{pageParam}</span> of{' '}
                        <span className="text-white font-semibold">{totalPages}</span>
                      </span>
                      <button
                        onClick={() => handlePageChange(pageParam + 1)}
                        disabled={pageParam >= totalPages}
                        className="px-4 py-2 rounded-xl glass text-sm text-gray-300 hover:text-white
                                   disabled:opacity-40 disabled:cursor-not-allowed transition-colors
                                   focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        Next →
                      </button>
                    </nav>
                  )}
                </>
              )}
            </div>
          </div>
        </main>
      </div>
    </ErrorBoundary>
  );
}
