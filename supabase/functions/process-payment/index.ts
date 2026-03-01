import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CascadeOrchestrator } from '../_shared/payment/CascadeOrchestrator.ts';
import { PaymentRequest, PaymentStatus } from '../_shared/payment/types.ts';
import { logger } from '../_shared/utils/logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FEE_BY_TIER: Record<string, number> = {
  TIER_1: 0.20,
  TIER_2: 0.175,
  TIER_3: 0.15,
};

const STATUS_MAP: Record<string, string> = {
  [PaymentStatus.PENDING]: 'PENDING',
  [PaymentStatus.PROCESSING]: 'PROCESSING',
  [PaymentStatus.COMPLETED]: 'SUCCEEDED',
  [PaymentStatus.FAILED]: 'FAILED',
  [PaymentStatus.REFUNDED]: 'REFUNDED',
  [PaymentStatus.CANCELLED]: 'FAILED',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Authenticate user via JWT
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

    // Parse request body
    const paymentRequest: PaymentRequest = await req.json();

    // Validate request
    if (!paymentRequest.amount || !paymentRequest.currency || !paymentRequest.paymentMethod) {
      return new Response(
        JSON.stringify({ error: 'Invalid payment request' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const listingId = paymentRequest.metadata.listingId as string;
    if (!listingId) {
      return new Response(
        JSON.stringify({ error: 'Missing listing ID' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use service role for privileged DB operations
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get listing details
    const { data: listing, error: listingError } = await supabase
      .from('listings')
      .select('id, title, seller_id, category_id')
      .eq('id', listingId)
      .single();

    if (listingError || !listing) {
      logger.error('Listing not found', { listingId, error: listingError });
      return new Response(
        JSON.stringify({ error: 'Listing not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get auction for current price
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

    // Content flags are provided by the client in the payment request metadata
    const contentFlags = (paymentRequest.metadata.contentFlags as string[]) || [];
    paymentRequest.metadata.sellerId = listing.seller_id;

    logger.info('Processing payment', {
      listingId: listing.id,
      auctionId: auction.id,
      contentFlags,
    });

    // Initialize orchestrator and process payment through cascade
    const orchestrator = new CascadeOrchestrator({ supabaseUrl, supabaseKey });
    const result = await orchestrator.processPayment(paymentRequest);

    // Calculate platform fee using seller's tier
    const { data: seller } = await supabase
      .from('users')
      .select('seller_tier')
      .eq('id', listing.seller_id)
      .single();

    const feeRate = FEE_BY_TIER[seller?.seller_tier ?? 'TIER_1'];
    const amountCents = result.amount;
    const platformFeeCents = Math.round(amountCents * feeRate);
    const sellerPayoutCents = amountCents - platformFeeCents;

    // Payment window: 20 min for card, 72 hours for crypto
    const isCrypto = paymentRequest.paymentMethod.type === 'CRYPTO';
    const windowMs = isCrypto ? 72 * 60 * 60 * 1000 : 20 * 60 * 1000;
    const paymentWindowExpiry = new Date(Date.now() + windowMs).toISOString();

    const riskLevel = ((result.processorResponse as any)?.riskAssessment?.level as string) ?? 'LOW';
    const selectedProcessor = (result.processorResponse as any)?.selectedProcessor ?? null;
    const txStatus = STATUS_MAP[result.status] ?? 'PENDING';

    // Create transaction record
    if (result.transactionId) {
      const { error: txError } = await supabase
        .from('transactions')
        .insert({
          id: result.transactionId,
          auction_id: auction.id,
          buyer_id: userId,
          seller_id: listing.seller_id,
          amount_cents: amountCents,
          currency: paymentRequest.currency,
          content_flags: contentFlags,
          risk_level: riskLevel,
          platform_fee_cents: platformFeeCents,
          seller_payout_cents: sellerPayoutCents,
          status: txStatus,
          successful_processor: result.success ? selectedProcessor : null,
          payment_window_expires_at: paymentWindowExpiry,
          metadata: result.processorResponse as any,
        });

      if (txError) {
        logger.error('Failed to create transaction record', {
          transactionId: result.transactionId,
          error: txError,
        });
      }
    }

    logger.info('Payment processing complete', {
      success: result.success,
      status: result.status,
      transactionId: result.transactionId,
    });

    return new Response(
      JSON.stringify(result),
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
