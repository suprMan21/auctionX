import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { supabase } from '@/features/auth/lib/supabase';

interface Listing {
  id: string;
  title: string;
  current_price: number;
  status: string;
  ending_at: string;
  photo_url: string | null;
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
        .select('id, title, current_price, status, ending_at, photo_url')
        .eq('seller_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setListings(data || []);
    } catch (error) {
      console.error('Failed to load listings:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const badges = {
      draft: 'bg-gray-500/20 text-gray-300',
      active: 'bg-success-500/20 text-success-500',
      ended: 'bg-warning-500/20 text-warning-500',
      sold: 'bg-accent-500/20 text-accent-500',
    };

    return (
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${badges[status as keyof typeof badges] || badges.draft}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
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
                {listings.map((listing) => (
                  <article key={listing.id} className="glass rounded-2xl overflow-hidden hover:shadow-glow transition-all">
                    <Link to={`/listings/${listing.id}/edit`} className="block focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800 rounded-2xl">
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
                              ${listing.current_price.toFixed(2)}
                            </p>
                          </div>
                          {listing.status === 'active' && (
                            <div className="text-right">
                              <p className="text-gray-400 text-sm">Ends</p>
                              <p className="text-white font-medium">
                                {new Date(listing.ending_at).toLocaleDateString()}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </Link>
                  </article>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>
    </ErrorBoundary>
  );
}
