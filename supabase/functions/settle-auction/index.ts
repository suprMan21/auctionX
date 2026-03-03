/**
 * settle-auction Edge Function
 *
 * Initiates the post-auction settlement flow. Called by the Express admin endpoint
 * (POST /api/v1/admin/auctions/:id/settle) via a shared secret header.
 *
 * Flow:
 *  1. Verify shared secret (x-settle-secret header)
 *  2. Validate auction is ENDED and not already settled
 *  3. Idempotency check — return existing settlement if already created
 *  4. Determine winner (winner_id ?? high_bidder_id)
 *  5. If no winner: mark settlement CANCELLED, return
 *  6. Calculate platform fee via DB RPC
 *  7. Insert settlements row (PENDING_PAYMENT, 20-min window)
 *  8. Insert settlement_offers row (rank=1, same window)
 *
 * @module settle-auction
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logger } from '../_shared/utils/logger.ts';

/** Insert a notification row silently — errors never block the main flow. */
async function insertNotification(
  supabase: any,
  userId: string,
  type: string,
  title: string,
  body: string,
  actionUrl: string | null = null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await supabase.from('notifications').insert({
      user_id: userId, type, title, body, action_url: actionUrl, metadata,
    });
  } catch (_err) {
    // Silently ignore — notification failures must never block payment/settlement flow
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-settle-secret',
};

const PAYMENT_WINDOW_MS = 20 * 60 * 1000; // 20 minutes for card payments

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ─── 1. Verify shared secret ────────────────────────────────────────────
    const settleSecret = Deno.env.get('SETTLE_SECRET');
    const incomingSecret = req.headers.get('x-settle-secret');

    if (!settleSecret || incomingSecret !== settleSecret) {
      logger.warn('settle-auction: Unauthorized request (bad secret)');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── 2. Parse request ───────────────────────────────────────────────────
    const { auctionId } = await req.json();

    if (!auctionId) {
      return new Response(
        JSON.stringify({ error: 'auctionId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    logger.info('settle-auction: Processing', { auctionId });

    // ─── 3. Validate auction ────────────────────────────────────────────────
    const { data: auction, error: auctionError } = await supabase
      .from('auctions')
      .select('id, status, winner_id, high_bidder_id, current_price_cents, currency, listing_id, seller_id')
      .eq('id', auctionId)
      .single();

    if (auctionError || !auction) {
      logger.error('settle-auction: Auction not found', { auctionId, error: auctionError });
      return new Response(
        JSON.stringify({ error: 'Auction not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (auction.status !== 'ENDED') {
      return new Response(
        JSON.stringify({ error: `Auction is not ENDED (current status: ${auction.status})` }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── 4. Idempotency check ───────────────────────────────────────────────
    const { data: existing } = await supabase
      .from('settlements')
      .select('id, status')
      .eq('auction_id', auctionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (existing) {
      logger.info('settle-auction: Settlement already exists (idempotent)', {
        auctionId,
        settlementId: existing.id,
        status: existing.status,
      });
      return new Response(
        JSON.stringify({ settlementId: existing.id, status: existing.status, idempotent: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── 5. Determine winner ────────────────────────────────────────────────
    let winnerId: string | null = null;

    if (auction.winner_id) {
      winnerId = auction.winner_id;
    } else if (auction.high_bidder_id) {
      logger.warn('settle-auction: winner_id is null, falling back to high_bidder_id', {
        auctionId,
        high_bidder_id: auction.high_bidder_id,
      });
      winnerId = auction.high_bidder_id;
    }

    // ─── 6. No winner — create CANCELLED settlement ─────────────────────────
    if (!winnerId) {
      logger.info('settle-auction: No bids, creating CANCELLED settlement', { auctionId });

      const { data: cancelled, error: cancelErr } = await supabase
        .from('settlements')
        .insert({
          auction_id: auctionId,
          seller_id: auction.seller_id,
          gross_amount_cents: 0,
          platform_fee_cents: 0,
          processor_fee_cents: 0,
          net_amount_cents: 0,
          platform_fee_percent: 0,
          processor_fee_percent: 0,
          status: 'CANCELLED',
        })
        .select('id')
        .single();

      if (cancelErr) {
        logger.error('settle-auction: Failed to create CANCELLED settlement', { error: cancelErr });
        return new Response(
          JSON.stringify({ error: 'Failed to create settlement' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ settlementId: cancelled!.id, status: 'CANCELLED', winnerId: null }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── 7. Calculate platform fee ──────────────────────────────────────────
    const { data: seller } = await supabase
      .from('users')
      .select('seller_tier')
      .eq('id', auction.seller_id)
      .single();

    const sellerTier = seller?.seller_tier ?? 'TIER_1';
    let platformFeePercent = 20.00; // TIER_1 default

    const { data: feePercent, error: feeError } = await supabase
      .rpc('calculate_platform_fee_percent', { tier: sellerTier });

    if (!feeError && feePercent != null) {
      platformFeePercent = Number(feePercent);
    } else {
      logger.warn('settle-auction: Fee RPC failed, using TIER_1 default', { feeError, sellerTier });
    }

    const grossAmountCents = auction.current_price_cents ?? 0;
    const feeRate = platformFeePercent / 100;
    const platformFeeCents = Math.round(grossAmountCents * feeRate);
    // Processor fee is calculated at payout time; placeholder 0 for now
    const processorFeeCents = 0;
    const processorFeePercent = 0;
    const netAmountCents = grossAmountCents - platformFeeCents - processorFeeCents;

    const paymentWindowExpiresAt = new Date(Date.now() + PAYMENT_WINDOW_MS).toISOString();

    // ─── 8. Insert settlements row ──────────────────────────────────────────
    const { data: settlement, error: settlementErr } = await supabase
      .from('settlements')
      .insert({
        auction_id: auctionId,
        seller_id: auction.seller_id,
        buyer_id: winnerId,
        gross_amount_cents: grossAmountCents,
        platform_fee_cents: platformFeeCents,
        processor_fee_cents: processorFeeCents,
        net_amount_cents: netAmountCents,
        platform_fee_percent: platformFeePercent,
        processor_fee_percent: processorFeePercent,
        status: 'PENDING_PAYMENT',
        payment_window_expires_at: paymentWindowExpiresAt,
        offer_attempt: 1,
      })
      .select('id')
      .single();

    if (settlementErr || !settlement) {
      logger.error('settle-auction: Failed to insert settlement', { error: settlementErr });
      return new Response(
        JSON.stringify({ error: 'Failed to create settlement' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── 9. Insert settlement_offers row (rank=1) ───────────────────────────
    const { data: offer, error: offerErr } = await supabase
      .from('settlement_offers')
      .insert({
        settlement_id: settlement.id,
        bidder_id: winnerId,
        offer_price_cents: grossAmountCents,
        offer_rank: 1,
        status: 'PENDING_PAYMENT',
        payment_window_expires_at: paymentWindowExpiresAt,
      })
      .select('id')
      .single();

    if (offerErr) {
      logger.error('settle-auction: Failed to insert settlement_offer', { error: offerErr });
      // Settlement was created; log the error but don't fail the whole request.
      // The check-payment-window function will handle orphaned settlements.
    }

    // Notify winner (non-fatal)
    const frontendUrl = Deno.env.get('FRONTEND_URL') || 'http://localhost:5173';
    await insertNotification(
      supabase,
      winnerId,
      'AUCTION_WON',
      'You won the auction!',
      `Congratulations! You have 20 minutes to complete your payment of $${(grossAmountCents / 100).toFixed(2)}.`,
      `${frontendUrl}/settlements/${settlement.id}`,
      { settlementId: settlement.id, auctionId, priceCents: grossAmountCents },
    );

    logger.info('settle-auction: Settlement created successfully', {
      auctionId,
      settlementId: settlement.id,
      offerId: offer?.id,
      winnerId,
      grossAmountCents,
      platformFeePercent,
      paymentWindowExpiresAt,
    });

    return new Response(
      JSON.stringify({
        settlementId: settlement.id,
        offerId: offer?.id ?? null,
        winnerId,
        status: 'PENDING_PAYMENT',
        paymentWindowExpiresAt,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    logger.error('settle-auction: Unhandled error', { error: error instanceof Error ? error.message : String(error) });
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
