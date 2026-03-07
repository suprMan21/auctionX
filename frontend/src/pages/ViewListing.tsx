import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { listingsApi } from '../lib/api/listings';

export function ViewListing() {
  const { id } = useParams<{ id: string }>();
  const [listing, setListing] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  useEffect(() => {
    if (id) {
      loadListing(id);
    }
  }, [id]);

  const loadListing = async (listingId: string) => {
    try {
      setLoading(true);
      const data = await listingsApi.getById(listingId);
      setListing(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-800 flex items-center justify-center">
        <div className="text-gray-400">Loading listing...</div>
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="min-h-screen bg-dark-800 flex items-center justify-center">
        <div className="glass rounded-2xl p-8 max-w-md text-center">
          <p className="text-red-400 mb-4">{error || 'Listing not found'}</p>
          <div className="flex items-center justify-center gap-3">
            <Link
              to="/"
              className="px-4 py-2 rounded-xl border border-white/10 text-gray-300 hover:bg-white/5 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
            >
              Back to home
            </Link>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-primary-500 to-accent-500 text-white font-medium hover:opacity-90 shadow-glow transition-all focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const images = listing.listing_media?.filter((m: any) => m.type === 'IMAGE') || [];
  const videos = listing.listing_media?.filter((m: any) => m.type === 'VIDEO') || [];

  return (
    <div className="min-h-screen bg-dark-800 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="glass rounded-2xl overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 p-8">
            <div>
              {images.length > 0 ? (
                <div className="space-y-4">
                  <div className="aspect-square bg-dark-700 rounded-lg overflow-hidden">
                    <img
                      src={images[selectedImageIndex]?.url}
                      alt={listing.title}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  {images.length > 1 && (
                    <div className="grid grid-cols-5 gap-2">
                      {images.map((image: any, idx: number) => (
                        <button
                          key={idx}
                          onClick={() => setSelectedImageIndex(idx)}
                          className={`aspect-square rounded-md overflow-hidden border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800 ${
                            selectedImageIndex === idx
                              ? 'border-primary-500'
                              : 'border-white/10 hover:border-white/20'
                          }`}
                        >
                          <img
                            src={image.url}
                            alt={`${listing.title} ${idx + 1}`}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  )}

                  {videos.length > 0 && (
                    <div className="space-y-2">
                      {videos.map((video: any, idx: number) => (
                        <video
                          key={idx}
                          src={video.url}
                          controls
                          className="w-full rounded-lg"
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="aspect-square bg-dark-700 rounded-lg flex items-center justify-center">
                  <span className="text-gray-400">No images available</span>
                </div>
              )}
            </div>

            <div className="space-y-6">
              <div>
                <h1 className="text-3xl font-bold text-white">{listing.title}</h1>
                <div className="mt-2 flex items-center space-x-2">
                  <span className={`px-3 py-1 text-sm font-medium rounded-full ${
                    listing.status === 'ACTIVE' ? 'bg-green-900/30 text-green-400' : 'bg-dark-700 text-gray-400'
                  }`}>
                    {listing.status}
                  </span>
                </div>
              </div>

              {listing.reserve_price_cents > 0 && (
                <div className="border-t border-b border-white/10 py-4">
                  <p className="text-sm text-gray-400">Reserve Price</p>
                  <p className="text-3xl font-bold text-white">
                    ${(listing.reserve_price_cents / 100).toFixed(2)} {listing.currency}
                  </p>
                </div>
              )}

              <div>
                <h2 className="text-lg font-semibold text-white mb-2">Description</h2>
                <p className="text-gray-400 whitespace-pre-wrap">{listing.description || 'No description provided.'}</p>
              </div>

              <div className="border-t border-white/10 pt-4 space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-400">Condition</span>
                  <span className="text-sm font-medium text-white">{listing.condition}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-400">Location</span>
                  <span className="text-sm font-medium text-white">
                    {listing.city}, {listing.region}, {listing.country}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-400">Brand</span>
                  <span className="text-sm font-medium text-white">{listing.brand}</span>
                </div>
              </div>

              {listing.users && (
                <div className="border-t border-white/10 pt-4">
                  <h3 className="text-sm font-medium text-white mb-2">Seller</h3>
                  <Link
                    to={`/seller/${listing.users.id}`}
                    className="flex items-center space-x-3 p-3 rounded-lg hover:bg-white/5 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
                  >
                    {listing.users.photo_url ? (
                      <img
                        src={listing.users.photo_url}
                        alt={listing.users.display_name}
                        className="w-12 h-12 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">
                        <span className="text-gray-400 text-lg font-medium">
                          {listing.users.display_name?.[0] || '?'}
                        </span>
                      </div>
                    )}
                    <div>
                      <p className="font-medium text-white">{listing.users.display_name || 'Anonymous'}</p>
                      <p className="text-sm text-gray-400">Tier: {listing.users.seller_tier}</p>
                    </div>
                  </Link>
                </div>
              )}

              {listing.status === 'ACTIVE' && (
                <button className="w-full px-6 py-3 bg-gradient-to-r from-primary-500 to-accent-500 text-white rounded-xl font-medium hover:opacity-90 shadow-glow transition-all focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800">
                  Place Bid
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
