import { BaseProcessor } from '../BaseProcessor.ts';
import {
  PaymentRequest,
  PaymentResponse,
  PaymentMethod,
  ProcessorConfig,
  PaymentStatus,
} from '../types.ts';
import { logger } from '../../utils/logger.ts';

interface SignatureAuthResponse {
  result: number;
  resultcode: string;
  authcode?: string;
  transactionid?: string;
  avsresponse?: string;
  cvvresponse?: string;
  error?: string;
}

export class SignatureProcessor extends BaseProcessor {
  readonly name = 'Signature';
  private apiKey: string;
  private apiLoginId: string;
  private transactionKey: string;
  private apiUrl: string;

  constructor(config: ProcessorConfig) {
    super(config);
    
    this.apiKey = Deno.env.get('SIGNATURE_API_KEY') || '';
    this.apiLoginId = Deno.env.get('SIGNATURE_API_LOGIN_ID') || '';
    this.transactionKey = Deno.env.get('SIGNATURE_TRANSACTION_KEY') || '';
    this.apiUrl = Deno.env.get('SIGNATURE_API_URL') || 'https://secure.sigpay.net/api/transact.php';

    if (!this.apiKey || !this.apiLoginId || !this.transactionKey) {
      logger.warn('SignatureProcessor: Missing API credentials');
    }
  }

  async processPayment(
    amount: number,
    currency: string,
    paymentMethod: PaymentMethod,
    metadata: Record<string, unknown>
  ): Promise<PaymentResponse> {
    try {
      logger.info('SignatureProcessor: Processing payment', {
        amount,
        currency,
        listingId: metadata.listingId,
      });

      if (!this.apiKey || !this.apiLoginId || !this.transactionKey) {
        throw new Error('Signature Payments credentials not configured');
      }

      if (paymentMethod.type !== 'CARD') {
        throw new Error('Signature Payments only supports card payments');
      }

      // Validate card details
      if (!paymentMethod.cardNumber || !paymentMethod.cardExpiry || !paymentMethod.cardCvv) {
        throw new Error('Missing required card details');
      }

      // Format expiry (MM/YY -> MMYY)
      const expiry = paymentMethod.cardExpiry.replace(/\D/g, '');
      if (expiry.length !== 4) {
        throw new Error('Invalid card expiry format');
      }

      // Build transaction request
      const transactionData = new URLSearchParams({
        // Authentication
        apikey: this.apiKey,
        username: this.apiLoginId,
        password: this.transactionKey,
        
        // Transaction type
        type: 'sale',
        
        // Amount (in dollars, e.g., "19.99")
        amount: (amount / 100).toFixed(2),
        
        // Card details
        ccnumber: paymentMethod.cardNumber,
        ccexp: expiry,
        cvv: paymentMethod.cardCvv,
        
        // Billing info
        firstname: this.extractFirstName(paymentMethod.billingName || ''),
        lastname: this.extractLastName(paymentMethod.billingName || ''),
        email: paymentMethod.email || '',
        
        // Optional billing address
        ...(paymentMethod.billingAddress && {
          address1: paymentMethod.billingAddress.line1,
          city: paymentMethod.billingAddress.city,
          state: paymentMethod.billingAddress.state,
          zip: paymentMethod.billingAddress.postalCode,
          country: paymentMethod.billingAddress.country,
        }),
        
        // Order details
        orderid: metadata.listingId as string || '',
        orderdescription: metadata.description as string || 'AuctionX Purchase',
        
        // AVS verification
        avs: '1',
      });

      logger.debug('SignatureProcessor: Sending transaction request');

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: transactionData.toString(),
      });

      if (!response.ok) {
        throw new Error(`Signature API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.text();
      const parsedResult = this.parseQueryString(result) as SignatureAuthResponse;

      logger.debug('SignatureProcessor: Response received', {
        result: parsedResult.result,
        resultcode: parsedResult.resultcode,
      });

      // Result codes:
      // 1 = Transaction approved
      // 2 = Transaction declined
      // 3 = Error in transaction data
      if (parsedResult.result === 1) {
        return {
          success: true,
          transactionId: parsedResult.transactionid || '',
          status: PaymentStatus.COMPLETED,
          amount,
          currency,
          processorResponse: parsedResult,
        };
      }

      // Transaction declined or error
      const errorMessage = parsedResult.error || 
                          parsedResult.resultcode || 
                          'Transaction declined';

      return {
        success: false,
        error: errorMessage,
        status: PaymentStatus.FAILED,
        amount,
        currency,
        processorResponse: parsedResult,
      };

    } catch (error) {
      logger.error('SignatureProcessor: Payment failed', { error });
      
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
      logger.info('SignatureProcessor: Processing refund', {
        transactionId,
        amount,
      });

      if (!this.apiKey || !this.apiLoginId || !this.transactionKey) {
        throw new Error('Signature Payments credentials not configured');
      }

      const refundData = new URLSearchParams({
        apikey: this.apiKey,
        username: this.apiLoginId,
        password: this.transactionKey,
        type: 'refund',
        transactionid: transactionId,
        ...(amount && { amount: (amount / 100).toFixed(2) }),
      });

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: refundData.toString(),
      });

      if (!response.ok) {
        throw new Error(`Signature API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.text();
      const parsedResult = this.parseQueryString(result) as SignatureAuthResponse;

      if (parsedResult.result === 1) {
        return {
          success: true,
          transactionId: parsedResult.transactionid || transactionId,
          status: PaymentStatus.REFUNDED,
          amount: amount || 0,
          currency: 'USD',
          processorResponse: parsedResult,
        };
      }

      const errorMessage = parsedResult.error || parsedResult.resultcode || 'Refund failed';

      return {
        success: false,
        error: errorMessage,
        status: PaymentStatus.FAILED,
        amount: amount || 0,
        currency: 'USD',
        processorResponse: parsedResult,
      };

    } catch (error) {
      logger.error('SignatureProcessor: Refund failed', { error });
      
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
      // Signature Payments webhook verification
      // They use a security key that's sent with the webhook
      const formData = await request.formData();
      const securityKey = formData.get('security_key');
      
      const expectedKey = Deno.env.get('SIGNATURE_WEBHOOK_KEY');
      
      if (!expectedKey) {
        logger.warn('SignatureProcessor: Webhook security key not configured');
        return false;
      }
      
      return securityKey === expectedKey;
    } catch (error) {
      logger.error('SignatureProcessor: Webhook verification failed', { error });
      return false;
    }
  }

  async handleWebhook(request: Request): Promise<PaymentResponse | null> {
    try {
      logger.info('SignatureProcessor: Processing webhook');

      const isValid = await this.verifyWebhook(request);
      if (!isValid) {
        logger.warn('SignatureProcessor: Invalid webhook signature');
        return null;
      }

      const formData = await request.formData();
      const transactionId = formData.get('transaction_id') as string;
      const responseCode = formData.get('response_code') as string;
      const amount = parseFloat(formData.get('amount') as string || '0') * 100;

      // Response codes: 100 = Approved, anything else = declined/error
      const status = responseCode === '100' 
        ? PaymentStatus.COMPLETED 
        : PaymentStatus.FAILED;

      return {
        success: status === PaymentStatus.COMPLETED,
        transactionId,
        status,
        amount,
        currency: 'USD',
        processorResponse: Object.fromEntries(formData),
      };

    } catch (error) {
      logger.error('SignatureProcessor: Webhook handling failed', { error });
      return null;
    }
  }

  // Helper: Parse query string response
  private parseQueryString(str: string): Record<string, unknown> {
    const params = new URLSearchParams(str);
    const result: Record<string, unknown> = {};
    
    for (const [key, value] of params) {
      // Convert numeric strings to numbers
      if (/^\d+$/.test(value)) {
        result[key] = parseInt(value, 10);
      } else {
        result[key] = value;
      }
    }
    
    return result;
  }

  // Helper: Extract first name from full name
  private extractFirstName(fullName: string): string {
    return fullName.split(' ')[0] || '';
  }

  // Helper: Extract last name from full name
  private extractLastName(fullName: string): string {
    const parts = fullName.split(' ');
    return parts.length > 1 ? parts.slice(1).join(' ') : '';
  }
}
