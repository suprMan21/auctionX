import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { supabase } from '@/features/auth/lib/supabase';

interface Listing {
  id: string;
  title: string;
  status: string;
  auctions: Array<{ current_price_cents: number; end_time: string }> | null;
  listing_media: Array<{ url: string; sort_order: number }> | null;
}

export function MyListings() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    loadListings();
  }, [user, navigate]);

  const loadListings = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('listings')
        .select('id, title, status, auctions(current_price_cents, end_time), listing_media(url, sort_order)')
        .eq('seller_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setListings((data as unknown as Listing[]) || []);
    } catch (error) {
      console.error('Failed to load listings:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const badges = {
      DRAFT: 'bg-gray-500/20 text-gray-300',
      ACTIVE: 'bg-success-500/20 text-success-500',
      ENDED: 'bg-warning-500/20 text-warning-500',
      SOLD: 'bg-accent-500/20 text-accent-500',
    };

    return (
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${badges[status as keyof typeof badges] || badges.DRAFT}`}>
        {status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()}
      </span>
    );
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
        <main id="main-content" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <header className="flex items-center justify-between mb-12">
            <div>
              <h1 className="text-4xl font-bold text-white mb-2">
                My Listings
              </h1>
              <p className="text-gray-400">
                Manage your active and past auctions.
              </p>
            </div>
            <Link to="/create-listing">
              <Button variant="primary" size="lg">
                Create Listing
              </Button>
            </Link>
          </header>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-gray-400">Loading your listings...</p>
            </div>
          ) : listings.length === 0 ? (
            <section className="glass rounded-2xl p-12 text-center">
              <h2 className="text-2xl font-bold text-white mb-4">
                No listings yet
              </h2>
              <p className="text-gray-400 mb-6">
                Create your first listing to start selling.
              </p>
              <Link to="/create-listing">
                <Button variant="primary" size="lg">
                  Create First Listing
                </Button>
              </Link>
            </section>
          ) : (
            <section aria-labelledby="listings-heading">
              <h2 id="listings-heading" className="sr-only">Your listings</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {listings.map((listing) => {
                  const photoUrl = listing.listing_media?.[0]?.url ?? null;
                  const currentPriceCents = listing.auctions?.[0]?.current_price_cents ?? 0;
                  const endTime = listing.auctions?.[0]?.end_time ?? null;
                  return (
                    <article key={listing.id} className="glass rounded-2xl overflow-hidden hover:shadow-glow transition-all">
                      <Link to={`/listings/${listing.id}/edit`} className="block focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800 rounded-2xl">
                        {photoUrl ? (
                          <img
                            src={photoUrl}
                            alt=""
                            className="w-full h-48 object-cover"
                          />
                        ) : (
                          <div className="w-full h-48 bg-dark-600 flex items-center justify-center">
                            <span className="text-gray-500">No image</span>
                          </div>
                        )}
                        <div className="p-6">
                          <div className="flex items-start justify-between mb-3">
                            <h3 className="text-xl font-semibold text-white flex-1">
                              {listing.title}
                            </h3>
                            {getStatusBadge(listing.status)}
                          </div>
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-gray-400 text-sm">Current Price</p>
                              <p className="text-2xl font-bold text-gradient">
                                ${(currentPriceCents / 100).toFixed(2)}
                              </p>
                            </div>
                            {listing.status === 'ACTIVE' && endTime && (
                              <div className="text-right">
                                <p className="text-gray-400 text-sm">Ends</p>
                                <p className="text-white font-medium">
                                  {new Date(endTime).toLocaleDateString()}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      </Link>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </main>
      </div>
    </ErrorBoundary>
  );
}
