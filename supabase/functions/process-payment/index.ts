/**
 * process-payment Edge Function
 *
 * Orchestrates the payment cascade for auction settlements. Enforces server-side
 * content flag validation so buyers cannot misrepresent listing risk to access
 * cheaper processors (e.g., routing adult content through Stripe).
 *
 * Flow:
 *  1. Authenticate buyer via JWT
 *  2. Fetch listing + category (server-side is_nsfw floor)
 *  3. Fetch auction for amount
 *  4. Calculate platform fee via DB function
 *  5. Handle crypto path separately (NOWPayments — user opt-in, never auto-cascade)
 *  6. Pre-create transaction record (PENDING)
 *  7. Run CascadeOrchestrator — logs each attempt to payment_attempts
 *  8. Update transaction to final status
 *
 * @module process-payment
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CascadeOrchestrator } from '../_shared/payment/CascadeOrchestrator.ts';
import { PaymentRequest, PaymentStatus } from '../_shared/payment/types.ts';
import { logger } from '../_shared/utils/logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Maps internal PaymentStatus to transaction_status DB enum values.
 * transaction_status uses SUCCEEDED (not COMPLETED) per DB schema.
 */
const STATUS_MAP: Record<string, string> = {
  [PaymentStatus.PENDING]:    'PENDING',
  [PaymentStatus.PROCESSING]: 'PROCESSING',
  [PaymentStatus.COMPLETED]:  'SUCCEEDED',
  [PaymentStatus.FAILED]:     'FAILED',
  [PaymentStatus.REFUNDED]:   'REFUNDED',
  [PaymentStatus.CANCELLED]:  'FAILED',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ─── 1. Authenticate buyer via JWT ────────────────────────────────────────
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization') ?? '' },
        },
      }
    );

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const userId = user.id;

    logger.info('Process payment request', { userId });

    // ─── 2. Parse and validate request ────────────────────────────────────────
    const paymentRequest: PaymentRequest = await req.json();

    if (!paymentRequest.amount || !paymentRequest.currency || !paymentRequest.paymentMethod) {
      return new Response(
        JSON.stringify({ error: 'Invalid payment request: missing amount, currency, or paymentMethod' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const listingId = paymentRequest.metadata.listingId as string;
    if (!listingId) {
      return new Response(
        JSON.stringify({ error: 'Missing listing ID in metadata' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use service role for privileged DB operations
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ─── 3. Fetch listing with is_nsfw for server-side risk floor ─────────────
    const { data: listing, error: listingError } = await supabase
      .from('listings')
      .select('id, title, seller_id, category_id, is_nsfw')
      .eq('id', listingId)
      .single();

    if (listingError || !listing) {
      logger.error('Listing not found', { listingId, error: listingError });
      return new Response(
        JSON.stringify({ error: 'Listing not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch category is_nsfw for server-side minimum risk floor
    const { data: category } = await supabase
      .from('categories')
      .select('is_nsfw, name')
      .eq('id', listing.category_id)
      .single();

    // ─── 4. Fetch auction for current price ───────────────────────────────────
    const { data: auction, error: auctionError } = await supabase
      .from('auctions')
      .select('id, current_price_cents, status')
      .eq('listing_id', listingId)
      .single();

    if (auctionError || !auction) {
      logger.error('Auction not found for listing', { listingId, error: auctionError });
      return new Response(
        JSON.stringify({ error: 'Auction not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── 5. Server-side content flag enforcement ───────────────────────────────
    // Clients provide flags but CANNOT downgrade risk below the server-determined floor.
    // listings.is_nsfw → HIGH floor (ADULT_CONTENT); category.is_nsfw → MEDIUM floor (INTIMATE_ITEMS).
    // NOTE: categories.default_content_flag does not yet exist in the DB schema —
    //   is_nsfw serves as a binary MEDIUM/HIGH proxy until the enum is extended.
    //   See TODO.md for tracking the addition of granular per-category default flags.
    const clientFlags = (paymentRequest.metadata.contentFlags as string[]) || [];
    const serverFloorFlags: string[] = [];

    if (listing.is_nsfw) {
      // Listing-level NSFW flag → HIGH risk floor
      serverFloorFlags.push('ADULT_CONTENT');
    } else if (category?.is_nsfw) {
      // Category-level NSFW → MEDIUM risk floor (Intimate items but not explicitly explicit)
      serverFloorFlags.push('INTIMATE_ITEMS');
    }

    // Merge: client may add flags but cannot remove server-enforced floor
    const contentFlags = Array.from(new Set([...serverFloorFlags, ...clientFlags]));
    paymentRequest.metadata.contentFlags = contentFlags;
    paymentRequest.metadata.sellerId = listing.seller_id;

    logger.info('Processing payment', {
      listingId: listing.id,
      auctionId: auction.id,
      contentFlags,
      serverFloorFlags,
      categoryIsNsfw: category?.is_nsfw ?? false,
      listingIsNsfw: listing.is_nsfw,
    });

    // ─── 6. Calculate platform fee via DB function ────────────────────────────
    // Fetch seller tier then call DB function as single source of truth for fee %.
    const { data: seller } = await supabase
      .from('users')
      .select('seller_tier')
      .eq('id', listing.seller_id)
      .single();

    const sellerTier = seller?.seller_tier ?? 'TIER_1';
    let feeRate = 0.20; // TIER_1 default if RPC unavailable

    const { data: feePercent, error: feeError } = await supabase
      .rpc('calculate_platform_fee_percent', { tier: sellerTier });

    if (!feeError && feePercent != null) {
      feeRate = Number(feePercent) / 100;
    } else {
      logger.warn('Fee RPC failed, using TIER_1 default', { feeError, sellerTier });
    }

    const amountCents = paymentRequest.amount;
    const platformFeeCents = Math.round(amountCents * feeRate);
    const sellerPayoutCents = amountCents - platformFeeCents;

    // Payment window: 20 min for card, 72 hours for crypto
    const isCrypto = paymentRequest.paymentMethod.type === 'CRYPTO';
    const windowMs = isCrypto ? 72 * 60 * 60 * 1000 : 20 * 60 * 1000;
    const paymentWindowExpiry = new Date(Date.now() + windowMs).toISOString();

    // ─── 7. Handle crypto path (user opt-in, never auto-cascaded) ─────────────
    if (isCrypto) {
      // TODO: Replace with real NOWPayments API call when API keys are configured.
      // NOWPayments invoice creation: POST https://api.nowpayments.io/v1/invoice
      // Required env: NOWPAYMENTS_API_KEY, NOWPAYMENTS_IPN_SECRET
      logger.info('Crypto payment requested — NOWPayments integration pending');
      return new Response(
        JSON.stringify({
          status: 'AWAITING_CRYPTO',
          paymentWindow: 72 * 60 * 60, // seconds
          message: 'Crypto payments not yet configured. NOWPayments integration pending API key setup.',
        }),
        { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── 8. Determine risk level for transaction record ───────────────────────
    // We compute this before the cascade so the transaction record has the right risk_level
    // even if all processors fail. Risk level is derived from the merged content flags.
    const riskScores: Record<string, number> = {
      INTIMATE_ITEMS: 6, NSFW: 7, '18_PLUS': 7, ADULT_CONTENT: 8, EXPLICIT: 10,
    };
    const maxFlagScore = contentFlags.reduce((max, flag) => Math.max(max, riskScores[flag] ?? 1), 0);
    const preliminaryRisk: 'LOW' | 'MEDIUM' | 'HIGH' =
      maxFlagScore >= 6 ? 'HIGH' : maxFlagScore >= 3 ? 'MEDIUM' : 'LOW';

    // ─── 9. Pre-create transaction record (PENDING) ───────────────────────────
    // Creating before the cascade ensures a DB record exists even if the
    // orchestrator crashes mid-cascade. Payment attempts reference this ID.
    const transactionId = crypto.randomUUID();

    const { error: txCreateError } = await supabase
      .from('transactions')
      .insert({
        id: transactionId,
        auction_id: auction.id,
        buyer_id: userId,
        seller_id: listing.seller_id,
        amount_cents: amountCents,
        currency: paymentRequest.currency,
        content_flags: contentFlags,
        risk_level: preliminaryRisk,
        platform_fee_cents: platformFeeCents,
        seller_payout_cents: sellerPayoutCents,
        status: 'PENDING',
        payment_window_expires_at: paymentWindowExpiry,
        metadata: { listingId, auctionId: auction.id },
      });

    if (txCreateError) {
      logger.error('Failed to pre-create transaction record', {
        transactionId,
        error: txCreateError,
      });
      // Non-fatal: continue with cascade even without the pre-created record
    }

    // Pass transactionId so the orchestrator can log payment_attempts
    paymentRequest.metadata.transactionId = transactionId;

    // ─── 10. Run payment cascade ───────────────────────────────────────────────
    const orchestrator = new CascadeOrchestrator({ supabaseUrl, supabaseKey });
    const result = await orchestrator.processPayment(paymentRequest);

    const txStatus = STATUS_MAP[result.status] ?? 'FAILED';
    const selectedProcessor =
      (result.processorResponse as any)?.selectedProcessor ?? null;
    const processorPaymentId =
      result.transactionId ?? null; // Stripe PaymentIntent ID, etc.

    // ─── 11. Update transaction to final status ────────────────────────────────
    const txUpdatePayload: Record<string, unknown> = {
      status: txStatus,
      metadata: result.processorResponse ?? {},
      updated_at: new Date().toISOString(),
    };

    if (result.success) {
      txUpdatePayload.successful_processor = selectedProcessor;
      txUpdatePayload.successful_payment_id = processorPaymentId;
      txUpdatePayload.payment_completed_at = new Date().toISOString();
    }

    const { error: txUpdateError } = await supabase
      .from('transactions')
      .update(txUpdatePayload)
      .eq('id', transactionId);

    if (txUpdateError) {
      logger.error('Failed to update transaction record', {
        transactionId,
        error: txUpdateError,
      });
    }

    logger.info('Payment processing complete', {
      success: result.success,
      status: result.status,
      transactionId,
      processorPaymentId,
    });

    // Return our internal transactionId (not the processor's payment ID)
    return new Response(
      JSON.stringify({
        ...result,
        transactionId, // override with our UUID
      }),
      {
        status: result.success ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    logger.error('Payment processing error', { error });

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Internal server error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
