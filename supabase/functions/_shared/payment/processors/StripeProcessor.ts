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
        metadata,
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
