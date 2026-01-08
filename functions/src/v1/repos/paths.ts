/**
 * Centralized Firestore path builders.
 * This is NOT business logic—just consistent string construction.
 */

export const usersPath = (uid: string) => `users/${uid}`;

export const categoriesCollectionPath = () => `categories`;
export const categoryPath = (categoryId: string) => `categories/${categoryId}`;

export const listingsCollectionPath = () => `listings`;
export const listingPath = (listingId: string) => `listings/${listingId}`;

export const auctionsCollectionPath = (listingId: string) => `listings/${listingId}/auctions`;
export const auctionPath = (listingId: string, auctionId: string) =>
  `listings/${listingId}/auctions/${auctionId}`;

export const bidsCollectionPath = (listingId: string, auctionId: string) =>
  `listings/${listingId}/auctions/${auctionId}/bids`;
export const bidPath = (listingId: string, auctionId: string, bidId: string) =>
  `listings/${listingId}/auctions/${auctionId}/bids/${bidId}`;
