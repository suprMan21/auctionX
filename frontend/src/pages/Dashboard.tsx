import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { supabase } from '@/features/auth/lib/supabase';

interface Listing {
  id: string;
  title: string;
  current_price: number;
  ending_at: string;
  photo_url: string | null;
}

export function Dashboard() {
  const { user } = useAuth();
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadListings();
  }, []);

  const loadListings = async () => {
    try {
      const { data, error } = await supabase
        .from('listings')
        .select('id, title, current_price, ending_at, photo_url')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(12);

      if (error) throw error;
      setListings(data || []);
    } catch (error) {
      console.error('Failed to load listings:', error);
    } finally {
      setLoading(false);
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
        <main id="main-content" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <header className="mb-12">
            <h1 className="text-4xl font-bold text-white mb-4">
              Discover Exclusive Auctions
            </h1>
            <p className="text-gray-400 text-lg">
              Bid on memorabilia and unique items from your favorite creators.
            </p>
          </header>

          {user && (
            <section aria-labelledby="quick-actions-heading" className="mb-12">
              <h2 id="quick-actions-heading" className="text-2xl font-bold text-white mb-6">
                Quick Actions
              </h2>
              <div className="flex gap-4">
                <Link to="/create-listing">
                  <Button variant="primary" size="lg">
                    Create Listing
                  </Button>
                </Link>
                <Link to="/my-listings">
                  <Button variant="secondary" size="lg">
                    My Listings
                  </Button>
                </Link>
              </div>
            </section>
          )}

          <section aria-labelledby="active-listings-heading">
            <h2 id="active-listings-heading" className="text-2xl font-bold text-white mb-6">
              Active Auctions
            </h2>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <p className="text-gray-400">Loading listings...</p>
              </div>
            ) : listings.length === 0 ? (
              <div className="glass rounded-2xl p-12 text-center">
                <p className="text-gray-400 mb-4">No active auctions right now.</p>
                {user && (
                  <Link to="/create-listing">
                    <Button variant="primary" size="md">
                      Create First Listing
                    </Button>
                  </Link>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {listings.map((listing) => (
                  <article key={listing.id} className="glass rounded-2xl overflow-hidden hover:shadow-glow transition-all">
                    <Link to={`/listings/${listing.id}`} className="block focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800 rounded-2xl">
                      {listing.photo_url ? (
                        <img 
                          src={listing.photo_url} 
                          alt=""
                          className="w-full h-48 object-cover"
                        />
                      ) : (
                        <div className="w-full h-48 bg-dark-600 flex items-center justify-center">
                          <span className="text-gray-500">No image</span>
                        </div>
                      )}
                      <div className="p-6">
                        <h3 className="text-xl font-semibold text-white mb-2">
                          {listing.title}
                        </h3>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-gray-400 text-sm">Current Bid</p>
                            <p className="text-2xl font-bold text-gradient">
                              ${listing.current_price.toFixed(2)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-gray-400 text-sm">Ends</p>
                            <p className="text-white font-medium">
                              {new Date(listing.ending_at).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                      </div>
                    </Link>
                  </article>
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
    </ErrorBoundary>
  );
}
