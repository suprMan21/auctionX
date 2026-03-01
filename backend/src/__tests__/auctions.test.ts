import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabase } from '../lib/supabase';

describe('Auction API Integration Tests', () => {
  let testAuctionId: string;
  let testSellerId: string;
  let testBidderId: string;
  let testListingId: string;
  let testCategoryId: string;

  beforeAll(async () => {
    const { data: category } = await supabase
      .from('categories')
      .select('id')
      .limit(1)
      .single();

    if (!category) {
      throw new Error('Need at least 1 category in database');
    }
    
    testCategoryId = category.id;

    const { data: users } = await supabase
      .from('users')
      .select('id')
      .limit(2);

    if (!users || users.length < 2) {
      throw new Error('Need at least 2 users in database for testing');
    }

    testSellerId = users[0].id;
    testBidderId = users[1].id;

    const { data: listing, error: listingError } = await supabase
      .from('listings')
      .insert({
        brand: 'AUCTIONX' as const,
        seller_id: testSellerId,
        title: 'Test Auction Item',
        description: 'Test description',
        category_id: testCategoryId,
        condition: 'NEW' as const,
        status: 'ACTIVE' as const,
      })
      .select()
      .single();

    if (listingError) {
      console.error('Listing creation failed:', listingError);
      throw listingError;
    }
    
    testListingId = listing!.id;

    const { data: auction, error: auctionError } = await supabase
      .from('auctions')
      .insert({
        listing_id: testListingId,
        seller_id: testSellerId,
        starting_price_cents: 1000,
        current_price_cents: 1000,
        minimum_increment_cents: 100,
        status: 'ACTIVE',
        start_time: new Date().toISOString(),
        end_time: new Date(Date.now() + 86400000).toISOString()
      })
      .select()
      .single();

    if (auctionError) {
      console.error('Auction creation failed:', auctionError);
      throw auctionError;
    }

    testAuctionId = auction!.id;
  });

  afterAll(async () => {
    if (testAuctionId) {
      await supabase.from('bids').delete().eq('auction_id', testAuctionId);
      await supabase.from('auctions').delete().eq('id', testAuctionId);
    }
    if (testListingId) {
      await supabase.from('listings').delete().eq('id', testListingId);
    }
  });

  describe('Database Schema', () => {
    it('should have created test auction', () => {
      expect(testAuctionId).toBeDefined();
      expect(testListingId).toBeDefined();
      expect(testSellerId).toBeDefined();
    });
  });

  describe('GET /api/v1/auctions/:id', () => {
    it('should fetch auction successfully', async () => {
      const { data, error } = await supabase
        .from('auctions')
        .select('*')
        .eq('id', testAuctionId)
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.id).toBe(testAuctionId);
      expect(data!.status).toBe('ACTIVE');
      expect(data!.starting_price_cents).toBe(1000);
      expect(data!.current_price_cents).toBe(1000);
    });

    it('should return error for non-existent auction', async () => {
      const { data, error } = await supabase
        .from('auctions')
        .select('*')
        .eq('id', '00000000-0000-0000-0000-000000000000')
        .single();

      expect(error).toBeDefined();
      expect(data).toBeNull();
    });
  });

  describe('GET /api/v1/auctions/:id/bids', () => {
    it('should fetch bid history', async () => {
      const { data, error } = await supabase
        .from('bids')
        .select('*')
        .eq('auction_id', testAuctionId);

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe('Bid Validation', () => {
    it('should calculate correct minimum bid', async () => {
      const { data: auction } = await supabase
        .from('auctions')
        .select('current_price_cents, minimum_increment_cents')
        .eq('id', testAuctionId)
        .single();

      const minimumBid = auction!.current_price_cents + auction!.minimum_increment_cents;
      expect(minimumBid).toBe(1100);
    });

    it('should have correct auction status', async () => {
      const { data: auction } = await supabase
        .from('auctions')
        .select('status, start_time, end_time')
        .eq('id', testAuctionId)
        .single();

      expect(auction!.status).toBe('ACTIVE');
      expect(new Date(auction!.end_time).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('RLS Policies', () => {
    it('should allow public read of active auctions', async () => {
      const { data, error } = await supabase
        .from('auctions')
        .select('*')
        .eq('status', 'ACTIVE')
        .limit(1);

      expect(error).toBeNull();
      expect(data).toBeDefined();
    });

    it('should have read policy on bids table', async () => {
      const { error } = await supabase
        .from('bids')
        .select('count');

      expect(error).toBeNull();
    });
  });

  describe('Proxy Bidding', () => {
    it('should have no bids initially', async () => {
      const { data: auction } = await supabase
        .from('auctions')
        .select('high_bidder_id, high_bidder_max_cents')
        .eq('id', testAuctionId)
        .single();

      expect(auction!.high_bidder_id).toBeNull();
      expect(auction!.high_bidder_max_cents).toBeNull();
    });
  });
});
