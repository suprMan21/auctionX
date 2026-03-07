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
import { ContentRiskBadge } from '@/components/ContentRiskBadge';

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
  risk?: 'LOW' | 'MEDIUM' | 'HIGH';
  ageVerified?: boolean;
}

export function ListingCard({ listing, risk = 'LOW', ageVerified = true }: ListingCardProps) {
  const auction = listing.auctions?.[0] ?? null;
  const sortedMedia = listing.listing_media
    ? [...listing.listing_media].sort((a, b) => a.sort_order - b.sort_order)
    : [];
  const primaryImage = sortedMedia.find((m) => m.type === 'image') ?? sortedMedia[0] ?? null;
  const linkTo = auction ? `/auctions/${auction.id}` : `/listings/${listing.id}`;
  const isLocked = risk === 'HIGH' && !ageVerified;
  const isHighRisk = risk === 'HIGH';

  const cardGlow = isHighRisk ? 'hover:shadow-glow-unmentionables' : 'hover:shadow-glow';
  const priceGradient = isHighRisk ? 'text-gradient-unmentionables' : 'text-gradient';

  return (
    <article data-testid="listing-card" className={`group glass rounded-2xl overflow-hidden hover:border-white/20 ${cardGlow} transition-all duration-200`}>
      <Link
        to={isLocked ? '#' : linkTo}
        className="block focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800 rounded-2xl"
        aria-label={isLocked ? 'Age-restricted item' : listing.title}
        onClick={isLocked ? (e) => e.preventDefault() : undefined}
      >
        <div className="relative">
          {primaryImage ? (
            <img
              src={primaryImage.url}
              alt={isLocked ? 'Age-restricted item' : ''}
              className={`w-full h-56 object-cover transition-transform duration-300 group-hover:scale-110 ${isLocked ? 'blur-sm' : ''}`}
            />
          ) : (
            <div className="w-full h-56 bg-dark-700 flex items-center justify-center">
              <span className="text-gray-400 text-sm">No image</span>
            </div>
          )}

          {/* Locked overlay */}
          {isLocked && (
            <div className="absolute inset-0 backdrop-blur-xl bg-dark-800/40 flex flex-col items-center justify-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-unmentionables-400" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M12 1.5a5.25 5.25 0 00-5.25 5.25v3a3 3 0 00-3 3v6.75a3 3 0 003 3h10.5a3 3 0 003-3v-6.75a3 3 0 00-3-3v-3c0-2.9-2.35-5.25-5.25-5.25zm3.75 8.25v-3a3.75 3.75 0 10-7.5 0v3h7.5z" clipRule="evenodd" />
              </svg>
              <span className="text-unmentionables-300 text-sm font-medium">18+</span>
            </div>
          )}

          {/* Risk badge — top-left, only when not locked */}
          {!isLocked && risk !== 'LOW' && (
            <div className="absolute top-2 left-2">
              <ContentRiskBadge risk={risk} />
            </div>
          )}
        </div>

        <div className="p-4">
          <h3 className="text-white font-semibold text-base line-clamp-2 mb-1">
            {isLocked ? 'Age-restricted item' : listing.title}
          </h3>
          {!isLocked && listing.item_verifications?.[0]?.status === 'VERIFIED' && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-400 bg-green-900/30 px-2 py-0.5 rounded-full border border-green-800 mb-2">
              ✓ Verified
            </span>
          )}

          {auction && !isLocked ? (
            <div className="flex items-end justify-between">
              <div>
                <p className="text-gray-400 text-xs mb-0.5">Current bid</p>
                <p className={`text-xl font-bold ${priceGradient}`}>
                  {formatPrice(auction.current_price_cents)}
                </p>
              </div>
              <div className="text-right">
                {auction.status === 'ACTIVE' ? (
                  <p className="text-gray-300 text-xs">
                    {timeRemaining(auction.end_time)}
                  </p>
                ) : (
                  <span className="text-xs text-gray-400 bg-white/5 px-2 py-0.5 rounded-full">
                    {auction.status}
                  </span>
                )}
              </div>
            </div>
          ) : !isLocked ? (
            <p className="text-gray-400 text-sm">No active auction</p>
          ) : null}
        </div>
      </Link>
    </article>
  );
}
