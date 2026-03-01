import { BaseProcessor } from '../BaseProcessor.ts';
import {
  PaymentRequest,
  PaymentResponse,
  PaymentMethod,
  ProcessorConfig,
  PaymentStatus,
} from '../types.ts';
import { logger } from '../../utils/logger.ts';
import { createHash } from 'node:crypto';

interface CCBillWebhookData {
  subscriptionId?: string;
  transactionId?: string;
  clientAccnum?: string;
  clientSubacc?: string;
  timestamp?: string;
  formDigest?: string;
  approval?: string;
  declineReason?: string;
  amount?: string;
  currency?: string;
}

export class CCBillProcessor extends BaseProcessor {
  readonly name = 'CCBill';
  private accountNumber: string;
  private subAccountNumber: string;
  private flexFormsId: string;
  private saltKey: string;
  private apiUrl: string;

  constructor(config: ProcessorConfig) {
    super(config);
    
    this.accountNumber = Deno.env.get('CCBILL_ACCOUNT_NUMBER') || '';
    this.subAccountNumber = Deno.env.get('CCBILL_SUBACCOUNT_NUMBER') || '';
    this.flexFormsId = Deno.env.get('CCBILL_FLEXFORMS_ID') || '';
    this.saltKey = Deno.env.get('CCBILL_SALT_KEY') || '';
    this.apiUrl = 'https://api.ccbill.com/transactions';

    if (!this.accountNumber || !this.subAccountNumber || !this.flexFormsId || !this.saltKey) {
      logger.warn('CCBillProcessor: Missing API credentials');
    }
  }

  async processPayment(
    amount: number,
    currency: string,
    paymentMethod: PaymentMethod,
    metadata: Record<string, unknown>
  ): Promise<PaymentResponse> {
    try {
      logger.info('CCBillProcessor: Generating payment URL', {
        amount,
        currency,
        listingId: metadata.listingId,
      });

      if (!this.accountNumber || !this.subAccountNumber || !this.flexFormsId || !this.saltKey) {
        throw new Error('CCBill credentials not configured');
      }

      // CCBill uses hosted payment forms - we generate a payment URL
      // The user is redirected to CCBill's secure form
      // Payment confirmation comes via webhook

      const formPrice = (amount / 100).toFixed(2);
      const formPeriod = '2'; // 2 = one-time payment
      const currencyCode = this.getCurrencyCode(currency);
      
      // Generate form digest for security
      const formDigest = this.generateFormDigest(formPrice, formPeriod, currencyCode);

      // Build CCBill FlexForms URL
      const paymentUrl = new URL('https://api.ccbill.com/wap-frontflex/flexforms/' + this.flexFormsId);
      
      paymentUrl.searchParams.set('clientAccnum', this.accountNumber);
      paymentUrl.searchParams.set('clientSubacc', this.subAccountNumber);
      paymentUrl.searchParams.set('formPrice', formPrice);
      paymentUrl.searchParams.set('formPeriod', formPeriod);
      paymentUrl.searchParams.set('currencyCode', currencyCode);
      paymentUrl.searchParams.set('formDigest', formDigest);
      
      // Pass through order ID
      if (metadata.listingId) {
        paymentUrl.searchParams.set('orderId', metadata.listingId as string);
      }
      
      // Customer info
      if (paymentMethod.email) {
        paymentUrl.searchParams.set('email', paymentMethod.email);
      }

      logger.info('CCBillProcessor: Payment URL generated', {
        url: paymentUrl.toString(),
      });

      // Return pending status with payment URL
      // Frontend will redirect user to this URL
      // Webhook will update status when payment completes
      return {
        success: true,
        transactionId: `ccbill_pending_${Date.now()}`,
        status: PaymentStatus.PENDING,
        amount,
        currency,
        processorResponse: {
          paymentUrl: paymentUrl.toString(),
          requiresAction: true,
        },
      };

    } catch (error) {
      logger.error('CCBillProcessor: Payment URL generation failed', { error });
      
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
      logger.info('CCBillProcessor: Processing refund', {
        transactionId,
        amount,
      });

      // CCBill refunds are processed through their merchant portal
      // API refunds require special approval and different endpoint
      // For now, return error directing to manual refund

      return {
        success: false,
        error: 'CCBill refunds must be processed through the merchant portal',
        status: PaymentStatus.FAILED,
        amount: amount || 0,
        currency: 'USD',
      };

    } catch (error) {
      logger.error('CCBillProcessor: Refund failed', { error });
      
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
      // CCBill sends webhooks as query parameters
      const url = new URL(request.url);
      const params = url.searchParams;

      const subscriptionId = params.get('subscriptionId') || '';
      const timestamp = params.get('timestamp') || '';
      const digest = params.get('formDigest') || '';

      if (!subscriptionId || !timestamp || !digest) {
        logger.warn('CCBillProcessor: Missing required webhook parameters');
        return false;
      }

      // Verify digest
      const expectedDigest = this.generateWebhookDigest(subscriptionId, timestamp);
      
      return digest === expectedDigest;

    } catch (error) {
      logger.error('CCBillProcessor: Webhook verification failed', { error });
      return false;
    }
  }

  async handleWebhook(request: Request): Promise<PaymentResponse | null> {
    try {
      logger.info('CCBillProcessor: Processing webhook');

      const isValid = await this.verifyWebhook(request);
      if (!isValid) {
        logger.warn('CCBillProcessor: Invalid webhook signature');
        return null;
      }

      const url = new URL(request.url);
      const params = url.searchParams;

      const transactionId = params.get('transactionId') || params.get('subscriptionId') || '';
      const approval = params.get('approval') || '';
      const declineReason = params.get('declineReason') || '';
      const amount = parseFloat(params.get('amount') || '0') * 100;
      const currency = params.get('currency') || 'USD';

      // Approval codes: "1" = approved, "0" = declined
      const status = approval === '1' 
        ? PaymentStatus.COMPLETED 
        : PaymentStatus.FAILED;

      return {
        success: status === PaymentStatus.COMPLETED,
        transactionId,
        status,
        amount,
        currency,
        error: declineReason || undefined,
        processorResponse: Object.fromEntries(params),
      };

    } catch (error) {
      logger.error('CCBillProcessor: Webhook handling failed', { error });
      return null;
    }
  }

  // Helper: Generate form digest for security
  private generateFormDigest(price: string, period: string, currency: string): string {
    const hash = createHash('md5');
    const data = `${price}${period}${currency}${this.saltKey}`;
    hash.update(data);
    return hash.digest('hex');
  }

  // Helper: Generate webhook digest for verification
  private generateWebhookDigest(subscriptionId: string, timestamp: string): string {
    const hash = createHash('md5');
    const data = `${subscriptionId}${timestamp}${this.saltKey}`;
    hash.update(data);
    return hash.digest('hex');
  }

  // Helper: Convert currency code to CCBill currency code
  private getCurrencyCode(currency: string): string {
    const currencyMap: Record<string, string> = {
      'USD': '840',
      'EUR': '978',
      'GBP': '826',
      'CAD': '124',
      'AUD': '036',
      'JPY': '392',
    };

    return currencyMap[currency.toUpperCase()] || '840'; // Default to USD
  }
}
