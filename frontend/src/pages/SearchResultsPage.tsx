/**
 * SearchResultsPage — Search results with sorting and empty states
 *
 * Route: /search?q={query}
 * Queries: listings (joined with auctions + listing_media) filtered by ilike on title/description
 * Dependencies: ListingCard, formatPrice, timeRemaining
 *
 * Features:
 * - URL-synced search query (?q= param via useSearchParams)
 * - Sort: newest, ending soonest, price low/high (all client-side after fetch)
 * - Result count display
 * - Empty state for no results / empty query
 *
 * Note: Uses basic ilike search. Module 14 (Enhanced Search) will replace
 * with pg_trgm/tsvector full-text search.
 *
 * @module Module 06 — Browse & Search
 */
import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { supabase } from '@/features/auth/lib/supabase';
import { ListingCard } from '@/components/listings/ListingCard';

type SortOption = 'newest' | 'ending_soonest' | 'price_asc' | 'price_desc';

interface SearchListing {
  id: string;
  title: string;
  auctions: Array<{
    id: string;
    current_price_cents: number;
    end_time: string;
    status: string;
  }> | null;
  listing_media: Array<{
    url: string;
    type: string;
    sort_order: number;
  }> | null;
  item_verifications: Array<{
    id: string;
    status: string;
    token_name: string;
  }> | null;
}

function sortListings(listings: SearchListing[], sort: SortOption): SearchListing[] {
  const copy = [...listings];
  switch (sort) {
    case 'ending_soonest':
      return copy.sort((a, b) => {
        const aTime = a.auctions?.[0]?.end_time ? new Date(a.auctions[0].end_time).getTime() : Infinity;
        const bTime = b.auctions?.[0]?.end_time ? new Date(b.auctions[0].end_time).getTime() : Infinity;
        return aTime - bTime;
      });
    case 'price_asc':
      return copy.sort((a, b) => {
        const aPrice = a.auctions?.[0]?.current_price_cents ?? 0;
        const bPrice = b.auctions?.[0]?.current_price_cents ?? 0;
        return aPrice - bPrice;
      });
    case 'price_desc':
      return copy.sort((a, b) => {
        const aPrice = a.auctions?.[0]?.current_price_cents ?? 0;
        const bPrice = b.auctions?.[0]?.current_price_cents ?? 0;
        return bPrice - aPrice;
      });
    default:
      return copy; // newest: already fetch-order
  }
}

const SORT_LABELS: Record<SortOption, string> = {
  newest: 'Newest',
  ending_soonest: 'Ending Soonest',
  price_asc: 'Price ↑',
  price_desc: 'Price ↓',
};

export function SearchResultsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const query = searchParams.get('q') ?? '';

  const [inputValue, setInputValue] = useState(query);
  const [results, setResults] = useState<SearchListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<SortOption>('newest');

  // Sync input when URL changes (e.g., back/forward)
  useEffect(() => {
    setInputValue(query);
  }, [query]);

  // Fetch results when query changes
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    let mounted = true;
    setLoading(true);

    const fetchResults = async () => {
      try {
        const { data, error } = await supabase
          .from('listings')
          .select('id, title, auctions(id, current_price_cents, end_time, status), listing_media(url, type, sort_order), item_verifications(id, status, token_name)')
          .eq('status', 'ACTIVE')
          .or(`title.ilike.%${query}%,description.ilike.%${query}%`)
          .order('created_at', { ascending: false })
          .limit(48);

        if (error) throw error;
        if (mounted) setResults((data as unknown as SearchListing[]) || []);
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchResults();
    return () => { mounted = false; };
  }, [query]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (trimmed) {
      setSearchParams({ q: trimmed });
    }
  };

  const handleClearSearch = () => {
    navigate('/browse');
  };

  const sorted = sortListings(results, sort);

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
          {/* Results header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              {!loading && query && (
                <p className="text-gray-300">
                  <span className="text-white font-semibold">{results.length}</span>{' '}
                  {results.length === 1 ? 'result' : 'results'} for{' '}
                  <span className="text-white font-semibold">&lsquo;{query}&rsquo;</span>
                </p>
              )}
            </div>

            {results.length > 0 && (
              <div className="flex items-center gap-2" role="group" aria-label="Sort results">
                <span className="text-gray-400 text-sm">Sort:</span>
                {(Object.keys(SORT_LABELS) as SortOption[]).map((option) => (
                  <button
                    key={option}
                    onClick={() => setSort(option)}
                    className={[
                      'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                      'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800',
                      sort === option
                        ? 'bg-primary-600 text-white'
                        : 'bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white',
                    ].join(' ')}
                    aria-pressed={sort === option}
                  >
                    {SORT_LABELS[option]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Content */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <p className="text-gray-400">Searching…</p>
            </div>
          ) : !query.trim() ? (
            <div className="glass rounded-2xl p-12 text-center">
              <h2 className="text-2xl font-bold text-white mb-3">Enter a search term</h2>
              <p className="text-gray-400">Try searching for an athlete, team, or item type.</p>
            </div>
          ) : results.length === 0 ? (
            <div className="glass rounded-2xl p-12 text-center">
              <h2 className="text-2xl font-bold text-white mb-3">No results found</h2>
              <p className="text-gray-400 mb-6">
                No active listings matched &lsquo;{query}&rsquo;. Try a different search term.
              </p>
              <button
                onClick={handleClearSearch}
                className="inline-flex items-center px-6 py-3 rounded-xl bg-primary-600 hover:bg-primary-500
                           text-white font-semibold transition-colors focus:outline-none focus:ring-2
                           focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
              >
                Browse All Listings
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
              {sorted.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>
          )}
        </main>
      </div>
    </ErrorBoundary>
  );
}
