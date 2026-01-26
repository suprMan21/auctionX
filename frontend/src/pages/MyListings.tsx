import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listingsApi } from '../lib/api/listings';

export function MyListings() {
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadListings();
  }, []);

  const loadListings = async () => {
    try {
      setLoading(true);
      const data = await listingsApi.getMyListings();
      setListings(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this listing?')) return;

    try {
      await listingsApi.delete(id);
      setListings(listings.filter(l => l.id !== id));
    } catch (err) {
      alert('Failed to delete listing: ' + err.message);
    }
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      DRAFT: 'bg-gray-100 text-gray-800',
      ACTIVE: 'bg-green-100 text-green-800',
      SOLD: 'bg-blue-100 text-blue-800',
      CANCELLED: 'bg-red-100 text-red-800',
      PENDING_REVIEW: 'bg-yellow-100 text-yellow-800',
    };

    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${styles[status] || 'bg-gray-100 text-gray-800'}`} role="status">
        {status.replace('_', ' ')}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <main role="main">
          <div className="text-gray-600" role="status" aria-live="polite">Loading your listings...</div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <main role="main" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <header className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-900">My Listings</h1>
          <Link
            to="/listings/create"
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            aria-label="Create new listing"
          >
            Create Listing
          </Link>
        </header>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-md p-4" role="alert">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {listings.length === 0 ? (
          <section className="bg-white rounded-lg shadow p-12 text-center" aria-labelledby="empty-state-heading">
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
              />
            </svg>
            <h2 id="empty-state-heading" className="mt-2 text-sm font-medium text-gray-900">No listings</h2>
            <p className="mt-1 text-sm text-gray-500">Get started by creating a new listing.</p>
            <div className="mt-6">
              <Link
                to="/listings/create"
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
              >
                Create Listing
              </Link>
            </div>
          </section>
        ) : (
          <section aria-labelledby="listings-heading">
            <h2 id="listings-heading" className="sr-only">Your Listings</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {listings.map((listing) => (
                <article key={listing.id} className="bg-white rounded-lg shadow overflow-hidden hover:shadow-lg transition-shadow">
                  <div className="aspect-square bg-gray-200 relative">
                    {listing.listing_media && listing.listing_media.length > 0 ? (
                      <img
                        src={listing.listing_media[0].url}
                        alt={listing.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full" role="img" aria-label="No image available">
                        <span className="text-gray-400">No image</span>
                      </div>
                    )}
                    <div className="absolute top-2 right-2">
                      {getStatusBadge(listing.status)}
                    </div>
                  </div>

                  <div className="p-4">
                    <h3 className="text-lg font-semibold text-gray-900 truncate">{listing.title}</h3>
                    
                    {listing.description && (
                      <p className="mt-1 text-sm text-gray-600 line-clamp-2">{listing.description}</p>
                    )}

                    <div className="mt-2 flex items-center justify-between text-sm text-gray-500">
                      <span>Condition: {listing.condition}</span>
                      {listing.reserve_price_cents > 0 && (
                        <span className="font-medium text-gray-900">
                          ${(listing.reserve_price_cents / 100).toFixed(2)} {listing.currency}
                        </span>
                      )}
                    </div>

                    <nav className="mt-4 flex space-x-2" aria-label={`Actions for ${listing.title}`}>
                      <Link
                        to={`/listings/${listing.id}`}
                        className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 text-center"
                      >
                        View
                      </Link>
                      {listing.status === 'DRAFT' && (
                        <Link
                          to={`/listings/${listing.id}/edit`}
                          className="flex-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 text-center"
                        >
                          Edit
                        </Link>
                      )}
                      <button
                        onClick={() => handleDelete(listing.id)}
                        className="px-3 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-md hover:bg-red-100"
                        aria-label={`Delete ${listing.title}`}
                      >
                        Delete
                      </button>
                    </nav>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
