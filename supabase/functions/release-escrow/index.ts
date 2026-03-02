/**
 * release-escrow Edge Function
 *
 * Cron-triggered function that finds ESCROW_HOLD settlements whose
 * 72-hour window has expired (and are not disputed), creates a payout
 * record, and transitions the settlement to RELEASED.
 *
 * Auth: x-release-secret header must match RELEASE_ESCROW_SECRET env var.
 * Mirrors the shared-secret pattern used by settle-auction.
 *
 * Intended to be called via pg_cron or an external scheduler every 5 minutes.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { calculatePayout } from '../_shared/payment/payoutCalculation.ts';
import { logger } from '../_shared/utils/logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-release-secret',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Shared-secret authentication
  const releaseSecret = Deno.env.get('RELEASE_ESCROW_SECRET');
  if (!releaseSecret) {
    logger.error('release-escrow: RELEASE_ESCROW_SECRET not configured');
    return new Response(
      JSON.stringify({ error: 'Server misconfiguration' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const providedSecret = req.headers.get('x-release-secret');
  if (providedSecret !== releaseSecret) {
    logger.warn('release-escrow: Invalid secret provided');
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const stats = { processed: 0, released: 0, errors: 0 };

  try {
    // Query releasable settlements:
    // - status = ESCROW_HOLD (not DISPUTED — disputes keep status as DISPUTED, not ESCROW_HOLD)
    // - escrow_ends_at <= NOW() (window has expired)
    // - JOIN transactions to get the successful_processor
    const { data: settlements, error: queryError } = await supabase
      .from('settlements')
      .select(`
        id,
        seller_id,
        gross_amount_cents,
        platform_fee_cents,
        escrow_ends_at,
        transaction_id,
        transactions!inner(
          id,
          status,
          successful_processor
        )
      `)
      .eq('status', 'ESCROW_HOLD')
      .lte('escrow_ends_at', new Date().toISOString())
      .eq('transactions.status', 'SUCCEEDED');

    if (queryError) {
      logger.error('release-escrow: Failed to query releasable settlements', { error: queryError });
      return new Response(
        JSON.stringify({ error: 'Database query failed', details: queryError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    logger.info(`release-escrow: Found ${settlements?.length ?? 0} releasable settlements`);

    for (const settlement of (settlements ?? [])) {
      stats.processed++;

      try {
        const transaction = settlement.transactions as { id: string; status: string; successful_processor: string | null } | null;
        const processor = transaction?.successful_processor ?? 'STRIPE';

        const payout = calculatePayout(
          settlement.gross_amount_cents,
          settlement.platform_fee_cents,
          processor,
        );

        // Insert payout record
        const { data: payoutRecord, error: payoutInsertError } = await supabase
          .from('payouts')
          .insert({
            settlement_id: settlement.id,
            seller_id: settlement.seller_id,
            gross_amount_cents: payout.grossAmountCents,
            platform_fee_cents: payout.platformFeeCents,
            processor_fee_cents: payout.processorFeeCents,
            net_payout_cents: payout.netPayoutCents,
            payout_method: 'STRIPE_CONNECT',
            status: 'PENDING',
            eligible_at: settlement.escrow_ends_at,
            currency: 'CAD',
          })
          .select('id')
          .single();

        if (payoutInsertError || !payoutRecord) {
          logger.error('release-escrow: Failed to insert payout', {
            settlementId: settlement.id,
            error: payoutInsertError,
          });
          stats.errors++;
          continue;
        }

        // Update settlement → RELEASED
        const { error: settlementUpdateError } = await supabase
          .from('settlements')
          .update({
            status: 'RELEASED',
            escrow_released_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', settlement.id);

        if (settlementUpdateError) {
          logger.error('release-escrow: Failed to update settlement to RELEASED', {
            settlementId: settlement.id,
            error: settlementUpdateError,
          });
          stats.errors++;
          continue;
        }

        // Mark payout PROCESSING — Stripe Transfer stub
        // TODO: Implement actual Stripe Connect Transfer API call
        const { error: payoutUpdateError } = await supabase
          .from('payouts')
          .update({
            status: 'PROCESSING',
            initiated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', payoutRecord.id);

        if (payoutUpdateError) {
          logger.warn('release-escrow: Failed to mark payout PROCESSING', {
            payoutId: payoutRecord.id,
            error: payoutUpdateError,
          });
          // Non-fatal — settlement is already RELEASED; payout remains PENDING
        }

        logger.info('release-escrow: Stripe Transfer stub — would initiate transfer', {
          payoutId: payoutRecord.id,
          sellerId: settlement.seller_id,
          netPayoutCents: payout.netPayoutCents,
        });

        stats.released++;

        logger.info('release-escrow: Settlement released', {
          settlementId: settlement.id,
          payoutId: payoutRecord.id,
          netPayoutCents: payout.netPayoutCents,
        });
      } catch (itemError) {
        logger.error('release-escrow: Error processing settlement', {
          settlementId: settlement.id,
          error: itemError instanceof Error ? itemError.message : String(itemError),
        });
        stats.errors++;
      }
    }

    logger.info('release-escrow: Run complete', stats);

    return new Response(
      JSON.stringify({ success: true, ...stats }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    logger.error('release-escrow: Fatal error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
