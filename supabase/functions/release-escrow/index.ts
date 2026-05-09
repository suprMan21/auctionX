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
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { calculatePayout } from '../_shared/payment/payoutCalculation.ts';
import { logger } from '../_shared/utils/logger.ts';
import { sendEmail, emailRecipient } from '../_shared/postmark.ts';

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
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-release-secret',
};

Deno.serve(async (req) => {
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
        buyer_id,
        gross_amount_cents,
        platform_fee_cents,
        escrow_ends_at,
        transaction_id,
        auction_id,
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
        const settlementRecord = settlement as typeof settlement & { buyer_id: string | null; auction_id: string | null };
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

        // ── NFC Ownership Transfer (non-fatal) ──────────────────────────
        try {
          if (settlementRecord.buyer_id && settlementRecord.auction_id) {
            // Get listing_id from auction
            const { data: auction } = await supabase
              .from('auctions')
              .select('listing_id')
              .eq('id', settlementRecord.auction_id)
              .maybeSingle();

            if (auction?.listing_id) {
              const { data: verif } = await supabase
                .from('item_verifications')
                .select('id, current_owner_id')
                .eq('listing_id', auction.listing_id)
                .eq('status', 'VERIFIED')
                .maybeSingle();

              if (verif) {
                await supabase.from('ownership_transfers').insert({
                  verification_id: verif.id,
                  from_user_id: verif.current_owner_id,
                  to_user_id: settlementRecord.buyer_id,
                  transfer_type: 'SALE',
                  settlement_id: settlement.id,
                });
                await supabase
                  .from('item_verifications')
                  .update({ current_owner_id: settlementRecord.buyer_id })
                  .eq('id', verif.id);

                logger.info('release-escrow: NFC ownership transferred', {
                  verificationId: verif.id,
                  buyerId: settlementRecord.buyer_id,
                });
              }
            }
          }
        } catch (nfcErr) {
          logger.warn('release-escrow: NFC ownership transfer failed (non-fatal)', {
            settlementId: settlement.id,
            error: nfcErr instanceof Error ? nfcErr.message : String(nfcErr),
          });
        }

        // Notify seller and buyer of escrow release (non-fatal)
        const frontendUrl = Deno.env.get('FRONTEND_URL') || 'http://localhost:5173';
        const settlementUrl = `${frontendUrl}/settlements/${settlement.id}`;

        await insertNotification(
          supabase,
          settlement.seller_id,
          'ESCROW_RELEASED',
          'Escrow funds released',
          `The escrow for your sale has been released. Your payout of $${(payout.netPayoutCents / 100).toFixed(2)} is now being processed.`,
          settlementUrl,
          { settlementId: settlement.id, netPayoutCents: payout.netPayoutCents },
        );

        if (settlementRecord.buyer_id) {
          await insertNotification(
            supabase,
            settlementRecord.buyer_id,
            'ESCROW_RELEASED',
            'Transaction completed',
            'The escrow period has ended and the transaction is complete.',
            settlementUrl,
            { settlementId: settlement.id },
          );
        }

        // Notify seller of payout initiation
        await insertNotification(
          supabase,
          settlement.seller_id,
          'PAYOUT_COMPLETED',
          `Payout of $${(payout.netPayoutCents / 100).toFixed(2)} is on its way`,
          'Your payout is being processed and should arrive in your account within 2–5 business days.',
          `${frontendUrl}/payouts`,
          { payoutId: payoutRecord.id, netPayoutCents: payout.netPayoutCents },
        );

        // ── ESCROW_RELEASED emails (non-fatal, preference-aware) ────────────
        try {
          const sellerAmount = `$${(payout.netPayoutCents / 100).toFixed(2)}`;
          const sellerEmail = await emailRecipient(supabase, settlement.seller_id, 'ESCROW_RELEASED');
          if (sellerEmail) {
            await sendEmail({
              to: sellerEmail,
              subject: 'Escrow released — your payout is processing',
              htmlBody: `
                <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#13131a;color:#fff;padding:24px;border-radius:12px;">
                  <h2 style="color:#22c55e;margin:0 0 16px;">Payout Processing</h2>
                  <p>The escrow for your sale has been released. Your payout of <strong>${sellerAmount}</strong> is now being processed and should arrive in your account within 2–5 business days.</p>
                  <a href="${frontendUrl}/payouts" style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#7c3aed,#3b82f6);color:#fff;border-radius:8px;text-decoration:none;margin-top:16px;">View Payouts</a>
                </div>
              `,
            });
          }

          if (settlementRecord.buyer_id) {
            const buyerEmail = await emailRecipient(supabase, settlementRecord.buyer_id, 'ESCROW_RELEASED');
            if (buyerEmail) {
              await sendEmail({
                to: buyerEmail,
                subject: 'Your purchase is confirmed',
                htmlBody: `
                  <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#13131a;color:#fff;padding:24px;border-radius:12px;">
                    <h2 style="color:#22c55e;margin:0 0 16px;">Purchase Confirmed</h2>
                    <p>The escrow period has ended and your transaction is complete. The seller has been paid; expect shipping updates soon.</p>
                    <a href="${settlementUrl}" style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#7c3aed,#3b82f6);color:#fff;border-radius:8px;text-decoration:none;margin-top:16px;">View Order</a>
                  </div>
                `,
              });
            }
          }
        } catch (emailErr) {
          logger.warn('release-escrow: ESCROW_RELEASED email failed (non-fatal)', {
            settlementId: settlement.id,
            error: emailErr instanceof Error ? emailErr.message : String(emailErr),
          });
        }

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
