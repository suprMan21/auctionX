/**
 * SavedSearchesPage — Manage saved searches for the authenticated user
 *
 * Route: /saved-searches (ProtectedRoute)
 * API: GET /api/v1/search/saved, DELETE /api/v1/search/saved/:id
 *
 * Features:
 * - Lists all saved searches with name, query summary, filter chips, and date
 * - "Run" button reconstructs URL search params and navigates to /search
 * - "Delete" with per-row inline confirmation (no modal)
 * - Empty state with CTA to /search
 *
 * @module Module 14 — Enhanced Search
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { api, type SavedSearch, type SavedSearchFilters } from '@/lib/api';

/** Build a /search URL from a saved search's stored query and filters. */
function buildSearchUrl(item: SavedSearch): string {
  const params = new URLSearchParams();
  if (item.query) params.set('q', item.query);
  const f: SavedSearchFilters = item.filters ?? {};
  if (f.category) params.set('category', f.category);
  if (f.minPrice !== undefined) params.set('minPrice', String(f.minPrice));
  if (f.maxPrice !== undefined) params.set('maxPrice', String(f.maxPrice));
  if (f.condition) params.set('condition', f.condition);
  if (f.verifiedOnly) params.set('verifiedOnly', 'true');
  if (f.sort) params.set('sort', f.sort);
  return `/search?${params.toString()}`;
}

/** Format a filter object into readable chips for display. */
function filterChips(f: SavedSearchFilters): string[] {
  const chips: string[] = [];
  if (f.category) chips.push(`Category: ${f.category}`);
  if (f.minPrice !== undefined) chips.push(`Min $${(f.minPrice / 100).toFixed(0)}`);
  if (f.maxPrice !== undefined) chips.push(`Max $${(f.maxPrice / 100).toFixed(0)}`);
  if (f.condition) chips.push(f.condition);
  if (f.verifiedOnly) chips.push('Verified only');
  if (f.sort) chips.push(`Sort: ${f.sort.replace('_', ' ')}`);
  return chips;
}

export function SavedSearchesPage() {
  const navigate = useNavigate();
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Track which row has the delete confirmation open (by id)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    api.getSavedSearches()
      .then((data) => { if (mounted) setSavedSearches(data); })
      .catch((err) => { if (mounted) setError(err instanceof Error ? err.message : 'Failed to load saved searches'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await api.deleteSavedSearch(id);
      setSavedSearches((prev) => prev.filter((s) => s.id !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete saved search');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-dark-800">
        <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-3xl font-bold text-white">Saved Searches</h1>
            <Link
              to="/search"
              className="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-sm font-semibold
                         transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
            >
              New Search
            </Link>
          </div>

          {error && (
            <div className="glass rounded-2xl p-4 mb-6 border border-red-500/30">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <p className="text-gray-400">Loading saved searches…</p>
            </div>
          ) : savedSearches.length === 0 ? (
            <div className="glass rounded-2xl p-12 text-center">
              <h2 className="text-xl font-bold text-white mb-3">No saved searches yet</h2>
              <p className="text-gray-400 mb-6">
                Search for something and save it to find it quickly next time.
              </p>
              <button
                onClick={() => navigate('/search')}
                className="inline-flex items-center px-6 py-3 rounded-xl bg-primary-600 hover:bg-primary-500
                           text-white font-semibold transition-colors focus:outline-none focus:ring-2
                           focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
              >
                Start Searching
              </button>
            </div>
          ) : (
            <ul className="space-y-3" aria-label="Saved searches list">
              {savedSearches.map((item) => {
                const chips = filterChips(item.filters ?? {});
                const isConfirming = confirmDeleteId === item.id;
                const isDeleting = deleting === item.id;

                return (
                  <li key={item.id} className="glass rounded-2xl p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-semibold truncate">{item.name}</p>
                        {item.query && (
                          <p className="text-gray-400 text-sm mt-0.5">
                            Query: <span className="text-gray-300">&ldquo;{item.query}&rdquo;</span>
                          </p>
                        )}
                        {chips.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {chips.map((chip) => (
                              <span
                                key={chip}
                                className="inline-block px-2 py-0.5 rounded-full text-xs bg-white/5 text-gray-400 border border-white/10"
                              >
                                {chip}
                              </span>
                            ))}
                          </div>
                        )}
                        <p className="text-gray-400 text-xs mt-2">
                          Saved {new Date(item.created_at).toLocaleDateString()}
                          {item.notify_new_results && (
                            <span className="ml-2 text-primary-400">· Notifications on</span>
                          )}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => navigate(buildSearchUrl(item))}
                          className="px-3 py-1.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-sm font-medium
                                     transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500"
                          aria-label={`Run saved search: ${item.name}`}
                        >
                          Run
                        </button>

                        {isConfirming ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleDelete(item.id)}
                              disabled={isDeleting}
                              className="px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-medium
                                         transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
                              aria-label={`Confirm delete: ${item.name}`}
                            >
                              {isDeleting ? 'Deleting…' : 'Confirm'}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-sm
                                         transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(item.id)}
                            className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-red-600/20 text-gray-400 hover:text-red-400 text-sm
                                       transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500"
                            aria-label={`Delete saved search: ${item.name}`}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </main>
      </div>
    </ErrorBoundary>
  );
}
