import { BaseProcessor } from '../BaseProcessor.ts';
import {
  PaymentRequest,
  PaymentResponse,
  PaymentMethod,
  ProcessorConfig,
  PaymentStatus,
} from '../types.ts';
import { logger } from '../../utils/logger.ts';
import { createHmac } from 'node:crypto';

interface NOWPaymentsInvoice {
  id: string;
  order_id: string;
  order_description: string;
  price_amount: string;
  price_currency: string;
  pay_currency?: string;
  pay_amount?: string;
  pay_address?: string;
  invoice_url: string;
  created_at: string;
  updated_at: string;
  payment_status: string;
}

interface NOWPaymentsWebhook {
  payment_id: string;
  payment_status: string;
  pay_address: string;
  price_amount: number;
  price_currency: string;
  pay_amount: number;
  pay_currency: string;
  order_id: string;
  order_description: string;
  created_at: string;
  updated_at: string;
  outcome_amount: number;
  outcome_currency: string;
}

export class NOWPaymentsProcessor extends BaseProcessor {
  readonly name = 'NOWPayments';
  private apiKey: string;
  private ipnSecret: string;
  private apiUrl: string;
  private sandboxMode: boolean;

  constructor(config: ProcessorConfig) {
    super(config);
    
    this.apiKey = Deno.env.get('NOWPAYMENTS_API_KEY') || '';
    this.ipnSecret = Deno.env.get('NOWPAYMENTS_IPN_SECRET') || '';
    this.sandboxMode = Deno.env.get('NOWPAYMENTS_SANDBOX') === 'true';
    this.apiUrl = this.sandboxMode 
      ? 'https://api-sandbox.nowpayments.io/v1'
      : 'https://api.nowpayments.io/v1';

    if (!this.apiKey || !this.ipnSecret) {
      logger.warn('NOWPaymentsProcessor: Missing API credentials');
    }
  }

  async processPayment(
    amount: number,
    currency: string,
    paymentMethod: PaymentMethod,
    metadata: Record<string, unknown>
  ): Promise<PaymentResponse> {
    try {
      logger.info('NOWPaymentsProcessor: Creating invoice', {
        amount,
        currency,
        listingId: metadata.listingId,
      });

      if (!this.apiKey || !this.ipnSecret) {
        throw new Error('NOWPayments credentials not configured');
      }

      // NOWPayments doesn't accept direct card payments
      // It creates crypto invoices that users pay with crypto wallets
      if (paymentMethod.type === 'CARD') {
        throw new Error('NOWPayments only supports cryptocurrency payments');
      }

      // Create invoice
      const invoiceData = {
        price_amount: (amount / 100).toFixed(2),
        price_currency: currency.toLowerCase(),
        pay_currency: paymentMethod.cryptoCurrency?.toLowerCase() || 'btc',
        order_id: (metadata.listingId as string) || `order_${Date.now()}`,
        order_description: (metadata.description as string) || 'AuctionX Purchase',
        ipn_callback_url: metadata.webhookUrl as string || '',
        success_url: metadata.successUrl as string || '',
        cancel_url: metadata.cancelUrl as string || '',
      };

      logger.debug('NOWPaymentsProcessor: Sending invoice request', {
        order_id: invoiceData.order_id,
        pay_currency: invoiceData.pay_currency,
      });

      const response = await fetch(`${this.apiUrl}/invoice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify(invoiceData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`NOWPayments API error: ${response.status} ${errorText}`);
      }

      const invoice: NOWPaymentsInvoice = await response.json();

      logger.info('NOWPaymentsProcessor: Invoice created', {
        invoice_id: invoice.id,
        invoice_url: invoice.invoice_url,
      });

      // Return pending status with invoice URL
      // User must visit invoice_url to complete payment
      return {
        success: true,
        transactionId: invoice.id,
        status: PaymentStatus.PENDING,
        amount,
        currency,
        processorResponse: {
          invoiceUrl: invoice.invoice_url,
          payAddress: invoice.pay_address,
          payCurrency: invoice.pay_currency,
          payAmount: invoice.pay_amount,
          requiresAction: true,
        },
      };

    } catch (error) {
      logger.error('NOWPaymentsProcessor: Invoice creation failed', { error });
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Payment processing failed',
        status: PaymentStatus.FAILED,
        amount,
        currency,
      };
    }
  }

  async refundPayment(transactionId: string, amount?: number): Promise<PaymentResponse> {
    try {
      logger.info('NOWPaymentsProcessor: Processing refund', {
        transactionId,
        amount,
      });

      // NOWPayments doesn't support automatic refunds for crypto
      // Refunds must be processed manually by sending crypto back
      return {
        success: false,
        error: 'Cryptocurrency refunds must be processed manually',
        status: PaymentStatus.FAILED,
        amount: amount || 0,
        currency: 'USD',
      };

    } catch (error) {
      logger.error('NOWPaymentsProcessor: Refund failed', { error });
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Refund processing failed',
        status: PaymentStatus.FAILED,
        amount: amount || 0,
        currency: 'USD',
      };
    }
  }

  async verifyWebhook(request: Request): Promise<boolean> {
    try {
      // NOWPayments uses HMAC-SHA512 signature verification
      const signature = request.headers.get('x-nowpayments-sig');
      
      if (!signature) {
        logger.warn('NOWPaymentsProcessor: Missing webhook signature');
        return false;
      }

      const body = await request.text();
      
      // Generate expected signature
      const hmac = createHmac('sha512', this.ipnSecret);
      hmac.update(body);
      const expectedSignature = hmac.digest('hex');

      const isValid = signature === expectedSignature;

      if (!isValid) {
        logger.warn('NOWPaymentsProcessor: Invalid webhook signature', {
          received: signature,
          expected: expectedSignature,
        });
      }

      return isValid;

    } catch (error) {
      logger.error('NOWPaymentsProcessor: Webhook verification failed', { error });
      return false;
    }
  }

  async handleWebhook(request: Request): Promise<PaymentResponse | null> {
    try {
      logger.info('NOWPaymentsProcessor: Processing webhook');

      const isValid = await this.verifyWebhook(request);
      if (!isValid) {
        logger.warn('NOWPaymentsProcessor: Invalid webhook signature');
        return null;
      }

      // Parse webhook body (we already read it in verifyWebhook, need to clone)
      const clonedRequest = request.clone();
      const webhook: NOWPaymentsWebhook = await clonedRequest.json();

      logger.debug('NOWPaymentsProcessor: Webhook data received', {
        payment_id: webhook.payment_id,
        payment_status: webhook.payment_status,
      });

      // NOWPayments status values:
      // waiting, confirming, confirmed, sending, partially_paid, finished, failed, refunded, expired
      const statusMap: Record<string, PaymentStatus> = {
        'waiting': PaymentStatus.PENDING,
        'confirming': PaymentStatus.PENDING,
        'confirmed': PaymentStatus.PROCESSING,
        'sending': PaymentStatus.PROCESSING,
        'finished': PaymentStatus.COMPLETED,
        'partially_paid': PaymentStatus.PENDING,
        'failed': PaymentStatus.FAILED,
        'refunded': PaymentStatus.REFUNDED,
        'expired': PaymentStatus.FAILED,
      };

      const status = statusMap[webhook.payment_status] || PaymentStatus.PENDING;

      return {
        success: status === PaymentStatus.COMPLETED,
        transactionId: webhook.payment_id,
        status,
        amount: Math.round(webhook.price_amount * 100),
        currency: webhook.price_currency.toUpperCase(),
        processorResponse: webhook,
      };

    } catch (error) {
      logger.error('NOWPaymentsProcessor: Webhook handling failed', { error });
      return null;
    }
  }

  // Helper: Get list of available cryptocurrencies
  async getAvailableCurrencies(): Promise<string[]> {
    try {
      if (!this.apiKey) {
        throw new Error('NOWPayments API key not configured');
      }

      const response = await fetch(`${this.apiUrl}/currencies`, {
        method: 'GET',
        headers: {
          'x-api-key': this.apiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`NOWPayments API error: ${response.status}`);
      }

      const data = await response.json();
      return data.currencies || [];

    } catch (error) {
      logger.error('NOWPaymentsProcessor: Failed to get currencies', { error });
      return [];
    }
  }

  // Helper: Get estimated price in crypto
  async getEstimatedPrice(amount: number, currency: string, cryptoCurrency: string): Promise<number | null> {
    try {
      if (!this.apiKey) {
        throw new Error('NOWPayments API key not configured');
      }

      const response = await fetch(
        `${this.apiUrl}/estimate?amount=${(amount / 100).toFixed(2)}&currency_from=${currency.toLowerCase()}&currency_to=${cryptoCurrency.toLowerCase()}`,
        {
          method: 'GET',
          headers: {
            'x-api-key': this.apiKey,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`NOWPayments API error: ${response.status}`);
      }

      const data = await response.json();
      return parseFloat(data.estimated_amount);

    } catch (error) {
      logger.error('NOWPaymentsProcessor: Failed to get estimate', { error });
      return null;
    }
  }
}
