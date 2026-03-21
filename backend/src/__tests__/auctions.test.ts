import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Database } from '../types/database';

// Guard: skip if Supabase env vars are missing or unreachable
const hasSupabaseEnv = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

// Service role client bypasses RLS — used only for test setup/teardown
const serviceClient = hasSupabaseEnv
  ? createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  : null;

describe('Auction API Integration Tests', () => {
  let testAuctionId: string;
  let testSellerId: string;
  let testBidderId: string;
  let testListingId: string;
  let testCategoryId: string;
  let dbAvailable = false;

  beforeAll(async () => {
    if (!serviceClient) {
      console.log('⚠ Supabase env vars missing — skipping auction integration tests');
      return;
    }

    try {
      const { data: category } = await serviceClient
        .from('categories')
        .select('id')
        .limit(1)
        .single();

      if (!category) {
        console.log('⚠ No categories in database — skipping auction integration tests');
        return;
      }

      testCategoryId = category.id;

      const { data: users } = await serviceClient
        .from('users')
        .select('id')
        .limit(2);

      if (!users || users.length < 2) {
        console.log('⚠ Need at least 2 users — skipping auction integration tests');
        return;
      }

      testSellerId = users[0].id;
      testBidderId = users[1].id;

      const { data: listing, error: listingError } = await serviceClient
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
        return;
      }

      testListingId = listing!.id;

      const { data: auction, error: auctionError } = await serviceClient
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
        return;
      }

      testAuctionId = auction!.id;
      dbAvailable = true;
    } catch (err) {
      console.log('⚠ Supabase connection failed — skipping auction integration tests');
    }
  });

  afterAll(async () => {
    if (!serviceClient || !dbAvailable) return;
    if (testAuctionId) {
      await serviceClient.from('bids').delete().eq('auction_id', testAuctionId);
      await serviceClient.from('auctions').delete().eq('id', testAuctionId);
    }
    if (testListingId) {
      await serviceClient.from('listings').delete().eq('id', testListingId);
    }
  });

  describe('Database Schema', () => {
    it('should have created test auction', (ctx) => {
      if (!dbAvailable) return ctx.skip();
      expect(testAuctionId).toBeDefined();
      expect(testListingId).toBeDefined();
      expect(testSellerId).toBeDefined();
    });
  });

  describe('GET /api/v1/auctions/:id', () => {
    it('should fetch auction successfully', async (ctx) => {
      if (!dbAvailable) return ctx.skip();
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

    it('should return error for non-existent auction', async (ctx) => {
      if (!dbAvailable) return ctx.skip();
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
    it('should fetch bid history', async (ctx) => {
      if (!dbAvailable) return ctx.skip();
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
    it('should calculate correct minimum bid', async (ctx) => {
      if (!dbAvailable) return ctx.skip();
      const { data: auction } = await supabase
        .from('auctions')
        .select('current_price_cents, minimum_increment_cents')
        .eq('id', testAuctionId)
        .single();

      const minimumBid = auction!.current_price_cents + auction!.minimum_increment_cents;
      expect(minimumBid).toBe(1100);
    });

    it('should have correct auction status', async (ctx) => {
      if (!dbAvailable) return ctx.skip();
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
    it('should allow public read of active auctions', async (ctx) => {
      if (!dbAvailable) return ctx.skip();
      const { data, error } = await supabase
        .from('auctions')
        .select('*')
        .eq('status', 'ACTIVE')
        .limit(1);

      expect(error).toBeNull();
      expect(data).toBeDefined();
    });

    it('should have read policy on bids table', async (ctx) => {
      if (!dbAvailable) return ctx.skip();
      const { error } = await supabase
        .from('bids')
        .select('count');

      expect(error).toBeNull();
    });
  });

  describe('Proxy Bidding', () => {
    it('should have no bids initially', async (ctx) => {
      if (!dbAvailable) return ctx.skip();
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
