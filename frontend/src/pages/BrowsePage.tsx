/**
 * BrowsePage — Main browse/discovery interface for listings
 *
 * Routes: /browse, /browse/:categorySlug
 * Queries: listings (joined with auctions + listing_media), categories
 * Dependencies: ListingCard, formatPrice, timeRemaining
 *
 * Features:
 * - Hero search bar (navigates to /search on submit)
 * - Category grid (fetched from categories table, slug column used for filtering)
 * - Active listings feed with auction data
 * - Category filtering via URL param :categorySlug (matched against categories.slug)
 * - Breadcrumb navigation when filtering by category
 *
 * @module Module 06 — Browse & Search
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { supabase } from '@/features/auth/lib/supabase';
import { ListingCard } from '@/components/listings/ListingCard';

interface Category {
  id: string;
  name: string;
  slug: string;
  brand_restriction: string | null;
  is_nsfw: boolean;
}

interface BrowseListing {
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

export function BrowsePage() {
  const { categorySlug } = useParams<{ categorySlug?: string }>();
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [listings, setListings] = useState<BrowseListing[]>([]);
  const [activeCategoryName, setActiveCategoryName] = useState<string | null>(null);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [loadingListings, setLoadingListings] = useState(true);

  // Fetch categories
  useEffect(() => {
    let mounted = true;
    const fetchCategories = async () => {
      try {
        const { data, error } = await supabase
          .from('categories')
          .select('id, name, slug, brand_restriction, is_nsfw')
          .order('sort_order' as never);
        if (error) throw error;
        if (mounted) setCategories((data as unknown as Category[]) || []);
      } catch (err) {
        console.error('Failed to load categories:', err);
      } finally {
        if (mounted) setLoadingCategories(false);
      }
    };
    fetchCategories();
    return () => { mounted = false; };
  }, []);

  // Fetch listings (with optional category filter)
  useEffect(() => {
    let mounted = true;
    setLoadingListings(true);

    const fetchListings = async () => {
      try {
        let categoryId: string | null = null;
        let categoryName: string | null = null;

        if (categorySlug) {
          const { data: catData, error: catError } = await supabase
            .from('categories')
            .select('id, name')
            .eq('slug', categorySlug)
            .single();
          if (catError) throw catError;
          categoryId = (catData as { id: string; name: string }).id;
          categoryName = (catData as { id: string; name: string }).name;
        }

        let query = supabase
          .from('listings')
          .select('id, title, auctions(id, current_price_cents, end_time, status), listing_media(url, type, sort_order), item_verifications(id, status, token_name)')
          .eq('status', 'ACTIVE')
          .order('created_at', { ascending: false })
          .limit(24);

        if (categoryId) {
          query = query.eq('category_id', categoryId);
        }

        const { data, error } = await query;
        if (error) throw error;

        if (mounted) {
          setListings((data as unknown as BrowseListing[]) || []);
          setActiveCategoryName(categoryName);
        }
      } catch (err) {
        console.error('Failed to load listings:', err);
      } finally {
        if (mounted) setLoadingListings(false);
      }
    };

    fetchListings();
    return () => { mounted = false; };
  }, [categorySlug]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

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
        {/* Hero */}
        <section className="relative py-20 px-4 text-center overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary-900/40 via-dark-800 to-dark-800 pointer-events-none" />
          <div className="relative max-w-3xl mx-auto">
            <h1 className="text-5xl md:text-6xl font-bold text-white mb-4">
              Discover Rare{' '}
              <span className="text-gradient">Collectibles</span>
            </h1>
            <p className="text-gray-400 text-lg mb-8">
              Bid on authentic memorabilia and exclusive creator items.
            </p>
            <form onSubmit={handleSearchSubmit} role="search" className="flex gap-3 max-w-xl mx-auto">
              <label htmlFor="hero-search" className="sr-only">Search listings</label>
              <input
                id="hero-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search listings…"
                className="flex-1 h-12 px-4 rounded-xl bg-white/5 border border-white/10 text-white
                           placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <button
                type="submit"
                className="h-12 px-6 rounded-xl bg-primary-600 hover:bg-primary-500 text-white font-semibold
                           transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
              >
                Search
              </button>
            </form>
          </div>
        </section>

        <main id="main-content" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
          {/* Breadcrumb */}
          {activeCategoryName && (
            <nav aria-label="Breadcrumb" className="mb-6">
              <ol className="flex items-center gap-2 text-sm text-gray-400">
                <li>
                  <Link to="/browse" className="hover:text-white transition-colors">Browse</Link>
                </li>
                <li aria-hidden="true">&rsaquo;</li>
                <li className="text-white font-medium" aria-current="page">{activeCategoryName}</li>
              </ol>
            </nav>
          )}

          {/* Categories */}
          {!categorySlug && (
            <section aria-labelledby="categories-heading" className="mb-12">
              <h2 id="categories-heading" className="text-2xl font-bold text-white mb-6">Categories</h2>
              {loadingCategories ? (
                <p className="text-gray-400">Loading categories…</p>
              ) : categories.length === 0 ? (
                <p className="text-gray-400">No categories available.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {categories.map((cat) => (
                    <Link
                      key={cat.id}
                      to={`/browse/${cat.slug}`}
                      className="glass rounded-2xl p-6 text-center hover:border-white/20 hover:shadow-glow
                                 transition-all duration-200 focus:outline-none focus:ring-2
                                 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
                    >
                      <p className="text-white font-semibold">{cat.name}</p>
                      {cat.is_nsfw && (
                        <span className="mt-1 inline-block text-xs text-warning-500 bg-warning-500/10 px-2 py-0.5 rounded-full">
                          18+
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Listings */}
          <section aria-labelledby="listings-heading">
            <h2 id="listings-heading" className="text-2xl font-bold text-white mb-6">
              {activeCategoryName ? activeCategoryName : 'Latest Listings'}
            </h2>

            {loadingListings ? (
              <div className="flex items-center justify-center py-16">
                <p className="text-gray-400">Loading listings…</p>
              </div>
            ) : listings.length === 0 ? (
              <div className="glass rounded-2xl p-12 text-center">
                <h3 className="text-xl font-bold text-white mb-3">No listings found</h3>
                <p className="text-gray-400 mb-6">
                  {categorySlug
                    ? 'No active listings in this category yet.'
                    : 'No active listings at the moment.'}
                </p>
                {categorySlug && (
                  <Link
                    to="/browse"
                    className="inline-flex items-center px-6 py-3 rounded-xl bg-primary-600 hover:bg-primary-500
                               text-white font-semibold transition-colors focus:outline-none focus:ring-2
                               focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
                  >
                    Browse All Categories
                  </Link>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
                {listings.map((listing) => (
                  <ListingCard key={listing.id} listing={listing} />
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
    </ErrorBoundary>
  );
}
