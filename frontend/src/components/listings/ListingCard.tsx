/**
 * ListingCard — Reusable auction listing card for browse/search grids
 *
 * Displays: first image (sorted by sort_order), title, current bid price, time remaining
 * Links to: /auctions/:auctionId when auction exists, /listings/:id as fallback
 * Used by: BrowsePage, SearchResultsPage
 *
 * Expects listing data with joined auctions and listing_media from Supabase query:
 * .select('*, auctions(id, current_price_cents, end_time, status), listing_media(url, type, sort_order)')
 *
 * Note: Supabase joins return arrays even for 1:1 — always access as listing.auctions?.[0]
 *
 * @module Module 06 — Browse & Search
 */
import { Link } from 'react-router-dom';
import { formatPrice } from '@/lib/utils/formatPrice';
import { timeRemaining } from '@/lib/utils/timeRemaining';

interface ListingCardProps {
  listing: {
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
  };
}

export function ListingCard({ listing }: ListingCardProps) {
  const auction = listing.auctions?.[0] ?? null;
  const sortedMedia = listing.listing_media
    ? [...listing.listing_media].sort((a, b) => a.sort_order - b.sort_order)
    : [];
  const primaryImage = sortedMedia.find((m) => m.type === 'image') ?? sortedMedia[0] ?? null;
  const linkTo = auction ? `/auctions/${auction.id}` : `/listings/${listing.id}`;

  return (
    <article className="glass rounded-2xl overflow-hidden hover:border-white/20 hover:shadow-glow transition-all duration-200">
      <Link
        to={linkTo}
        className="block focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800 rounded-2xl"
        aria-label={listing.title}
      >
        {primaryImage ? (
          <img
            src={primaryImage.url}
            alt=""
            className="w-full h-48 object-cover"
          />
        ) : (
          <div className="w-full h-48 bg-dark-700 flex items-center justify-center">
            <span className="text-gray-500 text-sm">No image</span>
          </div>
        )}

        <div className="p-4">
          <h3 className="text-white font-semibold text-base line-clamp-2 mb-1">
            {listing.title}
          </h3>
          {listing.item_verifications?.[0]?.status === 'VERIFIED' && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-400 bg-green-900/30 px-2 py-0.5 rounded-full border border-green-800 mb-2">
              ✓ Verified
            </span>
          )}

          {auction ? (
            <div className="flex items-end justify-between">
              <div>
                <p className="text-gray-400 text-xs mb-0.5">Current bid</p>
                <p className="text-xl font-bold text-gradient">
                  {formatPrice(auction.current_price_cents)}
                </p>
              </div>
              <div className="text-right">
                {auction.status === 'ACTIVE' ? (
                  <p className="text-gray-300 text-xs">
                    {timeRemaining(auction.end_time)}
                  </p>
                ) : (
                  <span className="text-xs text-gray-500 bg-white/5 px-2 py-0.5 rounded-full">
                    {auction.status}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No active auction</p>
          )}
        </div>
      </Link>
    </article>
  );
}
