# Module 09A: Stripe Payment Processor Integration

**Parent Module:** 09 - Auction Settlement  
**Processor:** Stripe  
**Risk Level:** LOW  
**Integration Type:** Direct API + Stripe.js

---

## Overview

Stripe is the primary processor for low-risk AuctionX brand content. It handles mainstream memorabilia, sports equipment, and autographed items.

**Supported Content Flags:**
- `CONCERT_GEAR`
- `MEMORABILIA`
- `AUTOGRAPHED`
- `SPORTS_EQUIPMENT`

**Card Networks:**
- ✅ Visa
- ✅ Mastercard
- ✅ Visa Debit
- ✅ Mastercard Debit
- ❌ American Express (excluded for consistency)

---

## Fee Structure

| Component | Rate |
|-----------|------|
| Transaction | 2.9% |
| Per-transaction | $0.30 CAD |
| Currency conversion | +1% for non-CAD |
| Refund | No fee (balance returned) |

---

## Integration Architecture

### Frontend: Stripe Elements

Use Stripe Elements for PCI-compliant card collection:

```
┌─────────────────────────────────────────────────┐
│                Payment Form                      │
├─────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────┐    │
│  │  Card Number (Stripe Element)           │    │
│  └─────────────────────────────────────────┘    │
│  ┌──────────────┐  ┌──────────────────────┐     │
│  │  Expiry      │  │  CVC                 │     │
│  └──────────────┘  └──────────────────────┘     │
│  ┌─────────────────────────────────────────┐    │
│  │  Postal Code                            │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│         [ Pay $XX.XX CAD ]                      │
└─────────────────────────────────────────────────┘
```

### Backend Flow

```
1. Frontend creates PaymentMethod via Stripe.js
2. Frontend sends PaymentMethod ID to backend
3. Backend creates PaymentIntent with:
   - Amount in cents
   - Currency (CAD)
   - PaymentMethod ID
   - Confirmation = manual
   - Capture method = automatic
4. Backend confirms PaymentIntent
5. Handle 3D Secure if required
6. Return result to frontend
7. Webhook confirms final status
```

---

## Implementation

### Processor Class

```typescript
import Stripe from 'stripe';
import { BaseProcessor } from './baseProcessor';
import {
  PaymentProcessor,
  PaymentResult,
  ProcessorHealth,
  RefundResult,
  Transaction,
  PaymentMethod,
  ValidationResult
} from '../types/payment';
import { logger } from '../lib/logger';

export class StripeProcessor extends BaseProcessor implements PaymentProcessor {
  readonly name = 'STRIPE' as const;
  readonly supportedCards = ['VISA', 'MASTERCARD'];
  readonly supportedContentFlags = [
    'CONCERT_GEAR',
    'MEMORABILIA',
    'AUTOGRAPHED',
    'SPORTS_EQUIPMENT'
  ];

  private client: Stripe;

  constructor() {
    super();
    this.client = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2024-12-18.acacia',
      typescript: true
    });
  }

  async initialize(): Promise<void> {
    const account = await this.client.accounts.retrieve();
    logger.info('Stripe processor initialized', {
      processor: this.name,
      accountId: account.id,
      chargesEnabled: account.charges_enabled
    });
  }

  async processPayment(
    transaction: Transaction,
    paymentMethod: PaymentMethod
  ): Promise<PaymentResult> {
    const startTime = Date.now();
    const correlationId = transaction.cascadeCorrelationId;

    try {
      if (paymentMethod.type !== 'CARD' || !paymentMethod.stripePaymentMethodId) {
        return this.createErrorResult(
          'INVALID_PAYMENT_METHOD',
          'Stripe payment method ID required',
          false,
          Date.now() - startTime
        );
      }

      const paymentIntent = await this.client.paymentIntents.create({
        amount: transaction.amountCents,
        currency: transaction.currency.toLowerCase(),
        payment_method: paymentMethod.stripePaymentMethodId,
        confirmation_method: 'manual',
        confirm: true,
        capture_method: 'automatic',
        description: `AuctionX Transaction ${transaction.id}`,
        metadata: {
          transaction_id: transaction.id,
          auction_id: transaction.auctionId,
          buyer_id: transaction.buyerId,
          seller_id: transaction.sellerId,
          correlation_id: correlationId
        },
        return_url: `${process.env.FRONTEND_URL}/payments/${transaction.id}/complete`
      });

      const responseTimeMs = Date.now() - startTime;

      if (paymentIntent.status === 'succeeded') {
        logger.info('Stripe payment succeeded', {
          processor: this.name,
          transactionId: transaction.id,
          correlationId,
          paymentIntentId: paymentIntent.id,
          responseTimeMs
        });

        return {
          success: true,
          processorPaymentId: paymentIntent.id,
          retryable: false,
          responseTimeMs,
          rawResponse: paymentIntent
        };
      }

      if (paymentIntent.status === 'requires_action') {
        return {
          success: false,
          errorCode: 'REQUIRES_3DS',
          errorMessage: '3D Secure authentication required',
          retryable: false,
          responseTimeMs,
          rawResponse: paymentIntent,
          clientSecret: paymentIntent.client_secret
        };
      }

      return this.createErrorResult(
        'PAYMENT_FAILED',
        `Unexpected status: ${paymentIntent.status}`,
        true,
        responseTimeMs,
        paymentIntent
      );

    } catch (error) {
      const responseTimeMs = Date.now() - startTime;
      return this.handleStripeError(error, responseTimeMs, transaction.id, correlationId);
    }
  }

  async refundPayment(
    originalPaymentId: string,
    amount?: number
  ): Promise<RefundResult> {
    const startTime = Date.now();

    try {
      const refund = await this.client.refunds.create({
        payment_intent: originalPaymentId,
        amount: amount,
        reason: 'requested_by_customer'
      });

      return {
        success: true,
        refundId: refund.id,
        responseTimeMs: Date.now() - startTime
      };
    } catch (error) {
      const responseTimeMs = Date.now() - startTime;
      
      if (error instanceof Stripe.errors.StripeError) {
        return {
          success: false,
          errorCode: error.code || 'REFUND_FAILED',
          errorMessage: error.message,
          responseTimeMs
        };
      }

      return {
        success: false,
        errorCode: 'UNKNOWN_ERROR',
        errorMessage: 'Failed to process refund',
        responseTimeMs
      };
    }
  }

  async healthCheck(): Promise<ProcessorHealth> {
    const startTime = Date.now();

    try {
      await this.client.balance.retrieve();
      const latencyMs = Date.now() - startTime;

      const successRate = await this.calculateSuccessRate('STRIPE');

      return {
        status: latencyMs < 1000 ? 'HEALTHY' : 'DEGRADED',
        latencyMs,
        successRate24h: successRate,
        checkedAt: new Date()
      };
    } catch (error) {
      return {
        status: 'DOWN',
        latencyMs: Date.now() - startTime,
        successRate24h: 0,
        lastError: error instanceof Error ? error.message : 'Unknown error',
        checkedAt: new Date()
      };
    }
  }

  async validatePaymentMethod(
    paymentMethod: PaymentMethod
  ): Promise<ValidationResult> {
    if (!paymentMethod.stripePaymentMethodId) {
      return {
        valid: false,
        errorCode: 'MISSING_PAYMENT_METHOD_ID',
        errorMessage: 'Stripe payment method ID is required'
      };
    }

    try {
      const pm = await this.client.paymentMethods.retrieve(
        paymentMethod.stripePaymentMethodId
      );

      if (pm.type !== 'card') {
        return {
          valid: false,
          errorCode: 'INVALID_PAYMENT_TYPE',
          errorMessage: 'Only card payments are supported'
        };
      }

      const brand = pm.card?.brand?.toUpperCase();
      if (!this.supportedCards.includes(brand || '')) {
        return {
          valid: false,
          errorCode: 'UNSUPPORTED_CARD_BRAND',
          errorMessage: `${brand} cards are not supported`
        };
      }

      return {
        valid: true,
        cardBrand: brand,
        cardLastFour: pm.card?.last4
      };
    } catch (error) {
      return {
        valid: false,
        errorCode: 'VALIDATION_FAILED',
        errorMessage: 'Failed to validate payment method'
      };
    }
  }

  private handleStripeError(
    error: unknown,
    responseTimeMs: number,
    transactionId: string,
    correlationId: string
  ): PaymentResult {
    if (error instanceof Stripe.errors.StripeError) {
      const errorMapping = this.mapStripeError(error);

      logger.warn('Stripe payment failed', {
        processor: this.name,
        transactionId,
        correlationId,
        errorCode: errorMapping.code,
        errorType: error.type,
        declineCode: error.decline_code,
        responseTimeMs
      });

      return this.createErrorResult(
        errorMapping.code,
        errorMapping.message,
        errorMapping.retryable,
        responseTimeMs,
        { type: error.type, code: error.code, decline_code: error.decline_code }
      );
    }

    logger.error('Stripe unknown error', {
      processor: this.name,
      transactionId,
      correlationId,
      error: error instanceof Error ? error.message : 'Unknown',
      responseTimeMs
    });

    return this.createErrorResult(
      'UNKNOWN_ERROR',
      'An unexpected error occurred',
      true,
      responseTimeMs
    );
  }

  private mapStripeError(error: Stripe.errors.StripeError): {
    code: string;
    message: string;
    retryable: boolean;
  } {
    const declineCode = error.decline_code;

    const nonRetryableDeclines = [
      'insufficient_funds',
      'lost_card',
      'stolen_card',
      'expired_card',
      'invalid_cvc',
      'invalid_number',
      'do_not_honor',
      'fraudulent',
      'pickup_card'
    ];

    if (declineCode && nonRetryableDeclines.includes(declineCode)) {
      return {
        code: `CARD_${declineCode.toUpperCase()}`,
        message: this.getHumanReadableDeclineMessage(declineCode),
        retryable: false
      };
    }

    switch (error.type) {
      case 'card_error':
        return {
          code: declineCode ? `CARD_${declineCode.toUpperCase()}` : 'CARD_DECLINED',
          message: error.message,
          retryable: !nonRetryableDeclines.includes(declineCode || '')
        };

      case 'rate_limit_error':
        return {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests, please try again',
          retryable: true
        };

      case 'api_connection_error':
        return {
          code: 'PROCESSOR_CONNECTION_ERROR',
          message: 'Unable to connect to payment processor',
          retryable: true
        };

      case 'api_error':
        return {
          code: 'PROCESSOR_ERROR',
          message: 'Payment processor error',
          retryable: true
        };

      case 'authentication_error':
        return {
          code: 'API_AUTHENTICATION_FAILED',
          message: 'Payment processor authentication failed',
          retryable: false
        };

      case 'invalid_request_error':
        return {
          code: 'INVALID_REQUEST',
          message: error.message,
          retryable: false
        };

      default:
        return {
          code: 'UNKNOWN_ERROR',
          message: 'An unexpected error occurred',
          retryable: true
        };
    }
  }

  private getHumanReadableDeclineMessage(declineCode: string): string {
    const messages: Record<string, string> = {
      insufficient_funds: 'Your card has insufficient funds',
      lost_card: 'This card has been reported lost',
      stolen_card: 'This card has been reported stolen',
      expired_card: 'Your card has expired',
      invalid_cvc: 'The security code is incorrect',
      invalid_number: 'The card number is invalid',
      do_not_honor: 'Your bank declined the transaction',
      fraudulent: 'This transaction was flagged as suspicious',
      pickup_card: 'This card cannot be used for online payments'
    };

    return messages[declineCode] || 'Your card was declined';
  }
}
```

### Webhook Handler

```typescript
import { Router } from 'express';
import Stripe from 'stripe';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

const router = Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia'
});

router.post('/stripe', async (req, res) => {
  const signature = req.headers['stripe-signature'] as string;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (error) {
    logger.error('Stripe webhook signature verification failed', { error });
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const requestId = req.headers['x-request-id'] as string || crypto.randomUUID();

  logger.info('Stripe webhook received', {
    requestId,
    eventType: event.type,
    eventId: event.id
  });

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
        break;

      case 'payment_intent.requires_action':
        await handleRequiresAction(event.data.object as Stripe.PaymentIntent);
        break;

      case 'charge.refunded':
        await handleRefund(event.data.object as Stripe.Charge);
        break;

      case 'charge.dispute.created':
        await handleDisputeCreated(event.data.object as Stripe.Dispute);
        break;

      default:
        logger.info('Unhandled Stripe event type', { eventType: event.type });
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('Stripe webhook processing error', {
      requestId,
      eventType: event.type,
      error: error instanceof Error ? error.message : 'Unknown'
    });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

async function handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  const transactionId = paymentIntent.metadata.transaction_id;

  if (!transactionId) {
    logger.warn('Payment succeeded but no transaction_id in metadata', {
      paymentIntentId: paymentIntent.id
    });
    return;
  }

  const { error } = await supabase
    .from('payment_transactions')
    .update({
      status: 'COMPLETED',
      processor_payment_id: paymentIntent.id,
      paid_at: new Date().toISOString(),
      escrow_release_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', transactionId);

  if (error) {
    logger.error('Failed to update transaction on payment success', {
      transactionId,
      error: error.message
    });
    throw error;
  }

  logger.info('Payment transaction completed', {
    transactionId,
    paymentIntentId: paymentIntent.id,
    amount: paymentIntent.amount
  });
}

async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
  const transactionId = paymentIntent.metadata.transaction_id;

  if (!transactionId) return;

  const lastError = paymentIntent.last_payment_error;

  await supabase
    .from('payment_attempts')
    .insert({
      transaction_id: transactionId,
      correlation_id: paymentIntent.metadata.correlation_id,
      processor: 'STRIPE',
      attempt_number: 1,
      cascade_position: 1,
      success: false,
      error_code: lastError?.code || 'UNKNOWN',
      error_message: lastError?.message || 'Payment failed',
      retryable: true,
      response_time_ms: 0,
      raw_response: lastError
    });

  logger.info('Payment attempt failed', {
    transactionId,
    paymentIntentId: paymentIntent.id,
    errorCode: lastError?.code
  });
}

async function handleRequiresAction(paymentIntent: Stripe.PaymentIntent) {
  const transactionId = paymentIntent.metadata.transaction_id;

  if (!transactionId) return;

  await supabase
    .from('payment_transactions')
    .update({
      status: 'PROCESSING',
      updated_at: new Date().toISOString()
    })
    .eq('id', transactionId);

  logger.info('Payment requires 3DS action', {
    transactionId,
    paymentIntentId: paymentIntent.id
  });
}

async function handleRefund(charge: Stripe.Charge) {
  const paymentIntentId = typeof charge.payment_intent === 'string' 
    ? charge.payment_intent 
    : charge.payment_intent?.id;

  if (!paymentIntentId) return;

  const { data: transaction } = await supabase
    .from('payment_transactions')
    .select('id')
    .eq('processor_payment_id', paymentIntentId)
    .single();

  if (transaction) {
    await supabase
      .from('payment_transactions')
      .update({
        status: 'REFUNDED',
        escrow_status: 'REFUNDED',
        updated_at: new Date().toISOString()
      })
      .eq('id', transaction.id);

    logger.info('Payment refunded via webhook', {
      transactionId: transaction.id,
      chargeId: charge.id
    });
  }
}

async function handleDisputeCreated(dispute: Stripe.Dispute) {
  const chargeId = typeof dispute.charge === 'string' 
    ? dispute.charge 
    : dispute.charge?.id;

  if (!chargeId) return;

  const charge = await stripe.charges.retrieve(chargeId);
  const paymentIntentId = typeof charge.payment_intent === 'string'
    ? charge.payment_intent
    : charge.payment_intent?.id;

  if (!paymentIntentId) return;

  const { data: transaction } = await supabase
    .from('payment_transactions')
    .select('id')
    .eq('processor_payment_id', paymentIntentId)
    .single();

  if (transaction) {
    await supabase
      .from('payment_transactions')
      .update({
        status: 'DISPUTED',
        escrow_status: 'DISPUTED',
        updated_at: new Date().toISOString()
      })
      .eq('id', transaction.id);

    logger.warn('Payment disputed', {
      transactionId: transaction.id,
      disputeId: dispute.id,
      reason: dispute.reason
    });
  }
}

export default router;
```

### Frontend Integration

```typescript
import { loadStripe, Stripe, StripeElements } from '@stripe/stripe-js';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

export async function createStripePaymentMethod(
  elements: StripeElements,
  billingDetails: {
    name: string;
    email: string;
    address: {
      postal_code: string;
    };
  }
): Promise<{ paymentMethodId: string } | { error: string }> {
  const stripe = await stripePromise;
  if (!stripe) {
    return { error: 'Stripe failed to initialize' };
  }

  const cardElement = elements.getElement('card');
  if (!cardElement) {
    return { error: 'Card element not found' };
  }

  const { paymentMethod, error } = await stripe.createPaymentMethod({
    type: 'card',
    card: cardElement,
    billing_details: billingDetails
  });

  if (error) {
    return { error: error.message || 'Failed to create payment method' };
  }

  return { paymentMethodId: paymentMethod.id };
}

export async function handle3DSecure(
  clientSecret: string
): Promise<{ success: boolean; error?: string }> {
  const stripe = await stripePromise;
  if (!stripe) {
    return { success: false, error: 'Stripe failed to initialize' };
  }

  const { error } = await stripe.confirmCardPayment(clientSecret);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
```

---

## Testing

### Stripe CLI for Webhooks

```bash
stripe listen --forward-to localhost:3001/api/v1/webhooks/stripe

stripe trigger payment_intent.succeeded
stripe trigger payment_intent.payment_failed
stripe trigger charge.refunded
```

### Test Card Numbers

| Scenario | Card Number |
|----------|-------------|
| Success | 4242424242424242 |
| Decline | 4000000000000002 |
| Insufficient funds | 4000000000009995 |
| Expired | 4000000000000069 |
| 3DS Required | 4000002760003184 |
| Processing error | 4000000000000119 |

### Test Scenarios

1. **Successful Payment**
   - Use 4242424242424242
   - Verify PaymentIntent created
   - Verify webhook received
   - Verify transaction status = COMPLETED

2. **Declined Card**
   - Use 4000000000000002
   - Verify error returned
   - Verify retryable = false
   - Verify cascade triggered to next processor

3. **3D Secure Flow**
   - Use 4000002760003184
   - Verify requires_action status
   - Complete 3DS challenge
   - Verify payment succeeds

4. **Refund Flow**
   - Complete successful payment
   - Trigger refund
   - Verify webhook updates transaction status

---

## Environment Variables

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

---

## Error Codes Reference

| Stripe Code | Internal Code | Retryable |
|-------------|---------------|-----------|
| card_declined | CARD_DECLINED | Sometimes |
| insufficient_funds | CARD_INSUFFICIENT_FUNDS | No |
| lost_card | CARD_LOST_CARD | No |
| stolen_card | CARD_STOLEN_CARD | No |
| expired_card | CARD_EXPIRED_CARD | No |
| invalid_cvc | CARD_INVALID_CVC | No |
| rate_limit | RATE_LIMIT_EXCEEDED | Yes |
| api_error | PROCESSOR_ERROR | Yes |

---

**END OF MODULE 09A - STRIPE INTEGRATION**
