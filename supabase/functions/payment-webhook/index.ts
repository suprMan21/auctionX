import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ProcessorFactory } from '../_shared/payment/ProcessorFactory.ts';
import { ProcessorType, PaymentStatus } from '../_shared/payment/types.ts';
import { logger } from '../_shared/utils/logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-nowpayments-sig, x-signature',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    logger.info('Webhook: Received request', {
      method: req.method,
      url: req.url,
      headers: Object.fromEntries(req.headers),
    });

    // Identify processor from URL path or headers
    const url = new URL(req.url);
    const processorType = identifyProcessor(req, url);

    if (!processorType) {
      logger.error('Webhook: Could not identify processor');
      return new Response(
        JSON.stringify({ error: 'Invalid webhook source' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    logger.info(`Webhook: Identified processor: ${processorType}`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Create processor instance
    const processor = ProcessorFactory.createProcessor(processorType, {
      supabaseUrl,
      supabaseKey,
    });

    // Handle webhook with processor
    const result = await processor.handleWebhook(req);

    if (!result) {
      logger.error('Webhook: Processor returned null (verification failed)');
      return new Response(
        JSON.stringify({ error: 'Webhook verification failed' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    logger.info('Webhook: Processor handled successfully', {
      transactionId: result.transactionId,
      status: result.status,
    });

    // Update transaction in database
    if (result.transactionId) {
      const { error: updateError } = await supabase
        .from('transactions')
        .update({
          status: result.status === 'COMPLETED' ? 'SUCCEEDED' : result.status,
          metadata: result.processorResponse,
          updated_at: new Date().toISOString(),
        })
        .eq('id', result.transactionId);

      if (updateError) {
        logger.error('Webhook: Failed to update transaction', {
          transactionId: result.transactionId,
          error: updateError,
        });
      } else {
        logger.info('Webhook: Transaction updated', {
          transactionId: result.transactionId,
          status: result.status,
        });
      }

      // If payment completed, update auction/listing status
      if (result.status === PaymentStatus.COMPLETED) {
        await handlePaymentCompleted(supabase, result.transactionId);
      }
    }

    // Return appropriate response based on processor
    const response = buildWebhookResponse(processorType, result);
    
    return new Response(
      JSON.stringify(response),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    logger.error('Webhook: Error processing webhook', { error });
    
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

// Helper: Identify which processor sent the webhook
function identifyProcessor(req: Request, url: URL): ProcessorType | null {
  // Check URL path
  const path = url.pathname.toLowerCase();
  
  if (path.includes('stripe')) return 'STRIPE';
  if (path.includes('paymentcloud') || path.includes('nmi')) return 'PAYMENTCLOUD';
  if (path.includes('signature')) return 'SIGNATURE';
  if (path.includes('ccbill')) return 'CCBILL';
  if (path.includes('nowpayments')) return 'NOWPAYMENTS';

  // Check headers
  const stripeSignature = req.headers.get('stripe-signature');
  if (stripeSignature) return 'STRIPE';

  const nowpaymentsSignature = req.headers.get('x-nowpayments-sig');
  if (nowpaymentsSignature) return 'NOWPAYMENTS';

  // Check URL parameters for CCBill
  if (url.searchParams.has('clientAccnum')) return 'CCBILL';

  // Check for PaymentCloud/NMI specific params
  if (url.searchParams.has('response_code') && url.searchParams.has('transactionid')) {
    return 'PAYMENTCLOUD';
  }

  // Check for Signature Payments specific params
  if (url.searchParams.has('transaction_id') && url.searchParams.has('security_key')) {
    return 'SIGNATURE';
  }

  return null;
}

// Helper: Build processor-specific webhook response
function buildWebhookResponse(processorType: ProcessorType, result: any): any {
  switch (processorType) {
    case 'STRIPE':
      // Stripe expects simple 200 OK
      return { received: true };

    case 'PAYMENTCLOUD':
    case 'SIGNATURE':
      // IPN-style processors expect specific response
      return { status: 'ok' };

    case 'CCBILL':
      // CCBill expects specific approval response
      return { approved: result.success ? 1 : 0 };

    case 'NOWPAYMENTS':
      // NOWPayments expects 200 OK with empty body
      return {};

    default:
      return { received: true };
  }
}

// Helper: Handle successful payment completion
async function handlePaymentCompleted(supabase: any, transactionId: string) {
  try {
    // Get transaction details
    const { data: transaction, error: txError } = await supabase
      .from('transactions')
      .select('auction_id, buyer_id, amount_cents')
      .eq('id', transactionId)
      .single();

    if (txError || !transaction) {
      logger.error('Webhook: Could not find transaction', { transactionId, error: txError });
      return;
    }

    logger.info('Webhook: Processing payment completion', {
      auctionId: transaction.auction_id,
      buyerId: transaction.buyer_id,
      amountCents: transaction.amount_cents,
    });

    // Get listing_id from auction
    const { data: auction } = await supabase
      .from('auctions')
      .select('listing_id')
      .eq('id', transaction.auction_id)
      .single();

    if (auction?.listing_id) {
      // Update listing status to sold
      const { error: listingError } = await supabase
        .from('listings')
        .update({
          status: 'SOLD',
          updated_at: new Date().toISOString(),
        })
        .eq('id', auction.listing_id);

      if (listingError) {
        logger.error('Webhook: Failed to update listing', {
          listingId: auction.listing_id,
          error: listingError,
        });
      }
    }

    // TODO: Trigger additional actions:
    // - Send confirmation email to buyer
    // - Send notification to seller
    // - Create payout record for seller
    // - Update auction winner status

    logger.info('Webhook: Payment completion handled', {
      auctionId: transaction.auction_id,
    });

  } catch (error) {
    logger.error('Webhook: Error handling payment completion', { error });
  }
}
