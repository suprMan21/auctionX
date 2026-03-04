/**
 * StripeProcessor — Stripe payment integration.
 *
 * Handles card payments for LOW risk content (Stripe does not accept adult content).
 * Implements processPayment (PaymentIntent), refund, healthCheck, and handleWebhook
 * (signature-verified event handling for payment-webhook Edge Function).
 *
 * @module StripeProcessor
 */
import Stripe from 'npm:stripe@14.17.0';
import { BaseProcessor } from '../BaseProcessor.ts';
import type {
  PaymentProcessor,
  PaymentMethod,
  ProcessorResult,
  RefundResult,
  HealthCheckResult,
  PaymentIntent
} from '../types.ts';
import { PaymentStatus, PaymentResponse } from '../types.ts';
import { logger } from '../../utils/logger.ts';

export class StripeProcessor extends BaseProcessor implements PaymentProcessor {
  readonly processorName = 'STRIPE';
  private stripe: Stripe;

  constructor() {
    super();
    const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }

    this.stripe = new Stripe(secretKey, {
      apiVersion: '2024-12-18.acacia',
      timeout: 30000,
    });
  }

  async processPayment(
    amount: number,
    currency: string,
    paymentMethod: PaymentMethod,
    metadata: Record<string, string>
  ): Promise<ProcessorResult> {
    try {
      this.validateAmount(amount);
      this.validateCurrency(currency);

      // Stripe metadata values must be strings. Build a clean object with only
      // the key correlation fields needed for webhook→transaction lookup.
      const stripeMetadata: Record<string, string> = {
        transactionId: (metadata['transactionId'] as string) ?? '',
        auctionId:     (metadata['auctionId'] as string) ?? '',
        listingId:     (metadata['listingId'] as string) ?? '',
        sellerId:      (metadata['sellerId'] as string) ?? '',
      };

      const paymentIntent = await this.stripe.paymentIntents.create({
        amount,
        currency: currency.toLowerCase(),
        payment_method_data: {
          type: 'card',
          card: {
            number: paymentMethod.cardNumber!,
            exp_month: parseInt(paymentMethod.cardExpiry!.split('/')[0]),
            exp_year: parseInt('20' + paymentMethod.cardExpiry!.split('/')[1]),
            cvc: paymentMethod.cardCvv!,
          },
          billing_details: {
            name: paymentMethod.billingName,
            email: paymentMethod.email,
          },
        },
        confirm: true,
        metadata: stripeMetadata,
      });

      if (paymentIntent.status === 'succeeded') {
        return {
          success: true,
          transactionId: paymentIntent.id,
          processor: this.processorName,
          amount,
          currency,
          metadata: {
            chargeId: paymentIntent.latest_charge as string,
            paymentMethodId: paymentIntent.payment_method as string,
          },
        };
      }

      return {
        success: false,
        processor: this.processorName,
        errorMessage: `Payment failed with status: ${paymentIntent.status}`,
        errorCode: 'PAYMENT_FAILED',
      };
    } catch (error) {
      logger.error('Stripe payment processing failed', error as Error, {
        processor: this.processorName,
        amount,
        currency,
      });

      return {
        success: false,
        processor: this.processorName,
        errorMessage: (error as Error).message,
        errorCode: this.mapStripeError(error),
      };
    }
  }

  /**
   * Verify Stripe webhook signature and parse the event into a PaymentResponse.
   * Returns null if signature verification fails (signals 401 to caller).
   *
   * Handles:
   *   - payment_intent.succeeded → PaymentStatus.COMPLETED
   *   - payment_intent.payment_failed → PaymentStatus.FAILED
   *   - all other events → returns a no-op response (acknowledged but not acted on)
   */
  async handleWebhook(req: Request): Promise<PaymentResponse | null> {
    const signature = req.headers.get('stripe-signature');
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

    if (!signature || !webhookSecret) {
      logger.error('Stripe webhook: missing stripe-signature header or STRIPE_WEBHOOK_SECRET env var');
      return null;
    }

    // Must read as text before constructEvent to preserve raw body for signature check
    const body = await req.text();

    let event: Stripe.Event;
    try {
      event = await this.stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
    } catch (err) {
      logger.error('Stripe webhook signature verification failed', {
        error: (err as Error).message,
      });
      return null;
    }

    logger.info('Stripe webhook: event received', { type: event.type, eventId: event.id });

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      // transactionId in Stripe metadata is our internal UUID set during processPayment
      const transactionId = paymentIntent.metadata?.transactionId ?? paymentIntent.id;

      return {
        success: true,
        transactionId,
        status: PaymentStatus.COMPLETED,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency.toUpperCase(),
        processorResponse: {
          stripeEventId: event.id,
          stripePaymentIntentId: paymentIntent.id,
        },
      };
    }

    if (event.type === 'payment_intent.payment_failed') {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const transactionId = paymentIntent.metadata?.transactionId ?? paymentIntent.id;

      return {
        success: false,
        transactionId,
        status: PaymentStatus.FAILED,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency.toUpperCase(),
        error: paymentIntent.last_payment_error?.message ?? 'Payment failed',
        processorResponse: {
          stripeEventId: event.id,
          stripePaymentIntentId: paymentIntent.id,
          failureCode: paymentIntent.last_payment_error?.code,
        },
      };
    }

    // Unhandled event type — acknowledge receipt without updating transaction state
    logger.info('Stripe webhook: unhandled event type, acknowledging without action', {
      type: event.type,
    });
    return {
      success: true,
      status: PaymentStatus.PENDING,
      amount: 0,
      currency: 'CAD',
      processorResponse: { stripeEventId: event.id, eventType: event.type },
    };
  }

  async refund(
    transactionId: string,
    amount?: number,
    reason?: string
  ): Promise<RefundResult> {
    try {
      const refund = await this.stripe.refunds.create({
        payment_intent: transactionId,
        amount,
        reason: reason as Stripe.RefundCreateParams.Reason,
      });

      return {
        success: true,
        refundId: refund.id,
        processor: this.processorName,
        amount: refund.amount,
        status: refund.status,
      };
    } catch (error) {
      logger.error('Stripe refund failed', error as Error, {
        processor: this.processorName,
        transactionId,
      });

      return {
        success: false,
        processor: this.processorName,
        errorMessage: (error as Error).message,
      };
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      await this.stripe.balance.retrieve();
      return {
        healthy: true,
        processor: this.processorName,
      };
    } catch (error) {
      return {
        healthy: false,
        processor: this.processorName,
        errorMessage: (error as Error).message,
      };
    }
  }

  private mapStripeError(error: any): string {
    if (error.type === 'StripeCardError') {
      return error.code || 'CARD_ERROR';
    }
    if (error.type === 'StripeInvalidRequestError') {
      return 'INVALID_REQUEST';
    }
    return 'PROCESSOR_ERROR';
  }
}
