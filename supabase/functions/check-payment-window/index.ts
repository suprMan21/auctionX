/**
 * check-payment-window Edge Function
 *
 * Checks for expired payment windows and cascades offers to the next eligible bidder.
 * Intended to be triggered by pg_cron every minute, or called manually.
 *
 * Uses UPDATE...RETURNING for atomic claim of expired offers to prevent race conditions
 * when multiple instances run concurrently.
 *
 * Flow per expired offer:
 *  1. Atomically claim expired PENDING_PAYMENT offers (UPDATE...RETURNING)
 *  2. Apply payment penalty via RPC (escalating: 7d → 30d → permanent ban)
 *  3. Build exclusion list from all previous offers for this settlement
 *  4. Find next eligible bidder via get_next_eligible_bidder RPC
 *  5a. If next bidder found: insert new offer (rank+1, 20-min window), update settlement
 *  5b. If no next bidder: cancel settlement, mark auction ENDED, mark listing re-listable
 *
 * @module check-payment-window
 */
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
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PAYMENT_WINDOW_MS = 20 * 60 * 1000; // 20 minutes

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    logger.info('check-payment-window: Starting check');

    // ─── 1. Atomically claim all expired PENDING_PAYMENT offers ─────────────
    // UPDATE...RETURNING prevents race conditions — only one invocation can
    // claim each row. Other concurrent invocations see the already-updated rows.
    const now = new Date().toISOString();

    const { data: expiredOffers, error: claimError } = await supabase
      .from('settlement_offers')
      .update({ status: 'EXPIRED', updated_at: now })
      .eq('status', 'PENDING_PAYMENT')
      .lt('payment_window_expires_at', now)
      .select('id, settlement_id, bidder_id, offer_price_cents, offer_rank');

    if (claimError) {
      logger.error('check-payment-window: Failed to claim expired offers', { error: claimError });
      return new Response(
        JSON.stringify({ error: 'Failed to query expired offers' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!expiredOffers || expiredOffers.length === 0) {
      logger.info('check-payment-window: No expired offers found');
      return new Response(
        JSON.stringify({ processed: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    logger.info('check-payment-window: Processing expired offers', { count: expiredOffers.length });

    let processed = 0;
    let cascaded = 0;
    let cancelled = 0;

    for (const offer of expiredOffers) {
      try {
        // ─── 2. Apply payment penalty ──────────────────────────────────────
        const { data: penaltyLevel, error: penaltyError } = await supabase
          .rpc('apply_payment_penalty', {
            p_user_id: offer.bidder_id,
            p_settlement_id: offer.settlement_id,
            p_offer_id: offer.id,
          });

        if (penaltyError) {
          logger.error('check-payment-window: Failed to apply penalty', {
            offerId: offer.id,
            bidderId: offer.bidder_id,
            error: penaltyError,
          });
          // Continue — don't block cascade on penalty failure
        } else {
          logger.info('check-payment-window: Penalty applied', {
            bidderId: offer.bidder_id,
            penaltyLevel,
          });
        }

        // ─── 3. Build exclusion list ───────────────────────────────────────
        const { data: previousOffers } = await supabase
          .from('settlement_offers')
          .select('bidder_id')
          .eq('settlement_id', offer.settlement_id);

        const excludeUids = (previousOffers ?? []).map((o: { bidder_id: string }) => o.bidder_id);

        // Get settlement to find auction_id
        const { data: settlement } = await supabase
          .from('settlements')
          .select('id, auction_id, seller_id, gross_amount_cents, platform_fee_cents, processor_fee_cents, net_amount_cents, platform_fee_percent, processor_fee_percent, offer_attempt')
          .eq('id', offer.settlement_id)
          .single();

        if (!settlement) {
          logger.error('check-payment-window: Settlement not found', { settlementId: offer.settlement_id });
          continue;
        }

        // ─── 4. Find next eligible bidder ──────────────────────────────────
        const { data: nextBidders, error: nextBidderError } = await supabase
          .rpc('get_next_eligible_bidder', {
            p_auction_id: settlement.auction_id,
            p_exclude_uids: excludeUids,
          });

        const nextBidder = nextBidders?.[0] ?? null;

        if (nextBidderError) {
          logger.error('check-payment-window: RPC get_next_eligible_bidder failed', {
            auctionId: settlement.auction_id,
            error: nextBidderError,
          });
        }

        if (nextBidder) {
          // ─── 5a. Cascade to next bidder ────────────────────────────────
          const newWindow = new Date(Date.now() + PAYMENT_WINDOW_MS).toISOString();
          const newRank = offer.offer_rank + 1;

          const { error: newOfferError } = await supabase
            .from('settlement_offers')
            .insert({
              settlement_id: offer.settlement_id,
              bidder_id: nextBidder.bidder_id,
              offer_price_cents: nextBidder.max_bid_cents,
              offer_rank: newRank,
              status: 'PENDING_PAYMENT',
              payment_window_expires_at: newWindow,
            });

          if (newOfferError) {
            logger.error('check-payment-window: Failed to insert next offer', {
              settlementId: offer.settlement_id,
              error: newOfferError,
            });
            continue;
          }

          const { error: settlementUpdateError } = await supabase
            .from('settlements')
            .update({
              buyer_id: nextBidder.bidder_id,
              payment_window_expires_at: newWindow,
              offer_attempt: (settlement.offer_attempt ?? 1) + 1,
              updated_at: newWindow,
            })
            .eq('id', offer.settlement_id);

          if (settlementUpdateError) {
            logger.error('check-payment-window: Failed to update settlement for cascade', {
              settlementId: offer.settlement_id,
              error: settlementUpdateError,
            });
          }

          logger.info('check-payment-window: Cascaded to next bidder', {
            settlementId: offer.settlement_id,
            nextBidderId: nextBidder.bidder_id,
            newRank,
            newWindow,
          });

          // Notify next bidder of their cascade offer (non-fatal)
          const frontendUrl = Deno.env.get('FRONTEND_URL') || 'http://localhost:5173';
          await insertNotification(
            supabase,
            nextBidder.bidder_id,
            'SETTLEMENT_CASCADE',
            'You have a purchase offer!',
            `A purchase offer has come to you. You have 20 minutes to complete payment of $${(nextBidder.max_bid_cents / 100).toFixed(2)}.`,
            `${frontendUrl}/settlements/${offer.settlement_id}`,
            { settlementId: offer.settlement_id, offerCents: nextBidder.max_bid_cents, rank: newRank },
          );

          cascaded++;
        } else {
          // ─── 5b. No next bidder — cancel settlement ─────────────────────
          const { error: cancelSettlementErr } = await supabase
            .from('settlements')
            .update({ status: 'CANCELLED', updated_at: now })
            .eq('id', offer.settlement_id);

          if (cancelSettlementErr) {
            logger.error('check-payment-window: Failed to cancel settlement', {
              settlementId: offer.settlement_id,
              error: cancelSettlementErr,
            });
          }

          // Update auction back to ENDED (remains unsold)
          const { error: auctionErr } = await supabase
            .from('auctions')
            .update({ status: 'ENDED', updated_at: now })
            .eq('id', settlement.auction_id);

          if (auctionErr) {
            logger.error('check-payment-window: Failed to update auction status', {
              auctionId: settlement.auction_id,
              error: auctionErr,
            });
          }

          // Update listing status back to ACTIVE so seller can relist
          const { data: auction } = await supabase
            .from('auctions')
            .select('listing_id')
            .eq('id', settlement.auction_id)
            .single();

          if (auction?.listing_id) {
            const { error: listingErr } = await supabase
              .from('listings')
              .update({ status: 'ACTIVE', updated_at: now })
              .eq('id', auction.listing_id);

            if (listingErr) {
              logger.error('check-payment-window: Failed to update listing status', {
                listingId: auction.listing_id,
                error: listingErr,
              });
            }
          }

          logger.info('check-payment-window: Settlement cancelled (no eligible bidders)', {
            settlementId: offer.settlement_id,
            auctionId: settlement.auction_id,
          });

          cancelled++;
        }

        processed++;
      } catch (offerError) {
        logger.error('check-payment-window: Error processing offer', {
          offerId: offer.id,
          error: offerError instanceof Error ? offerError.message : String(offerError),
        });
      }
    }

    logger.info('check-payment-window: Complete', { processed, cascaded, cancelled });

    return new Response(
      JSON.stringify({ processed, cascaded, cancelled }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    logger.error('check-payment-window: Unhandled error', {
      error: error instanceof Error ? error.message : String(error),
    });

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
