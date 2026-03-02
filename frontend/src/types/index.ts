export type Brand = 'AUCTIONX' | 'UNMENTIONABLES';

export type Currency = 'CAD' | 'USD';

export type ListingStatus = 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

export type AuctionStatus = 'SCHEDULED' | 'RUNNING' | 'CLOSED' | 'VOIDED';

export type SellerTier = 'TIER_1' | 'TIER_2' | 'TIER_3';

export interface User {
  uid: string;
  email?: string;
  displayName?: string;
  photoURL?: string;
  sellerTier?: {
    current: SellerTier;
    lifetimeSalesCents: number;
    last12MonthsSalesCents: number;
  };
}

export interface Listing {
  id: string;
  sellerUid: string;
  title: string;
  description?: string;
  brand: Brand;
  status: ListingStatus;
  media: ListingMedia[];
  pricing: {
    currency: Currency;
    reservePriceCents?: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ListingMedia {
  id: string;
  type: 'IMAGE' | 'VIDEO';
  url: string;
  thumbnailUrl?: string;
  sortOrder: number;
}

export interface Auction {
  id: string;
  listingId: string;
  status: AuctionStatus;
  schedule: {
    startAt: string;
    endAt: string;
  };
}
