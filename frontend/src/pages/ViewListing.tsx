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
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading listing...</div>
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error || 'Listing not found'}</p>
          <Link to="/" className="text-blue-600 hover:text-blue-700">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  const images = listing.listing_media?.filter((m: any) => m.type === 'IMAGE') || [];
  const videos = listing.listing_media?.filter((m: any) => m.type === 'VIDEO') || [];

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 p-8">
            <div>
              {images.length > 0 ? (
                <div className="space-y-4">
                  <div className="aspect-square bg-gray-200 rounded-lg overflow-hidden">
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
                          className={`aspect-square rounded-md overflow-hidden border-2 transition-colors ${
                            selectedImageIndex === idx
                              ? 'border-blue-600'
                              : 'border-gray-200 hover:border-gray-300'
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
                <div className="aspect-square bg-gray-200 rounded-lg flex items-center justify-center">
                  <span className="text-gray-400">No images available</span>
                </div>
              )}
            </div>

            <div className="space-y-6">
              <div>
                <h1 className="text-3xl font-bold text-gray-900">{listing.title}</h1>
                <div className="mt-2 flex items-center space-x-2">
                  <span className={`px-3 py-1 text-sm font-medium rounded-full ${
                    listing.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                  }`}>
                    {listing.status}
                  </span>
                </div>
              </div>

              {listing.reserve_price_cents > 0 && (
                <div className="border-t border-b border-gray-200 py-4">
                  <p className="text-sm text-gray-600">Reserve Price</p>
                  <p className="text-3xl font-bold text-gray-900">
                    ${(listing.reserve_price_cents / 100).toFixed(2)} {listing.currency}
                  </p>
                </div>
              )}

              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-2">Description</h2>
                <p className="text-gray-600 whitespace-pre-wrap">{listing.description || 'No description provided.'}</p>
              </div>

              <div className="border-t border-gray-200 pt-4 space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Condition</span>
                  <span className="text-sm font-medium text-gray-900">{listing.condition}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Location</span>
                  <span className="text-sm font-medium text-gray-900">
                    {listing.city}, {listing.region}, {listing.country}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Brand</span>
                  <span className="text-sm font-medium text-gray-900">{listing.brand}</span>
                </div>
              </div>

              {listing.users && (
                <div className="border-t border-gray-200 pt-4">
                  <h3 className="text-sm font-medium text-gray-900 mb-2">Seller</h3>
                  <Link
                    to={`/seller/${listing.users.id}`}
                    className="flex items-center space-x-3 p-3 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    {listing.users.photo_url ? (
                      <img
                        src={listing.users.photo_url}
                        alt={listing.users.display_name}
                        className="w-12 h-12 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center">
                        <span className="text-gray-500 text-lg font-medium">
                          {listing.users.display_name?.[0] || '?'}
                        </span>
                      </div>
                    )}
                    <div>
                      <p className="font-medium text-gray-900">{listing.users.display_name || 'Anonymous'}</p>
                      <p className="text-sm text-gray-500">Tier: {listing.users.seller_tier}</p>
                    </div>
                  </Link>
                </div>
              )}

              {listing.status === 'ACTIVE' && (
                <button className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors">
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
