import { BaseProcessor } from '../BaseProcessor.ts';
import type {
  PaymentProcessor,
  PaymentMethod,
  ProcessorResult,
  RefundResult,
  HealthCheckResult
} from '../types.ts';
import { logger } from '../../utils/logger.ts';

export class PaymentCloudProcessor extends BaseProcessor implements PaymentProcessor {
  readonly processorName = 'PAYMENTCLOUD';
  private apiKey: string;
  private endpoint: string;

  constructor() {
    super();
    const apiKey = Deno.env.get('PAYMENTCLOUD_API_KEY');
    if (!apiKey) {
      throw new Error('PAYMENTCLOUD_API_KEY environment variable is required');
    }
    
    this.apiKey = apiKey;
    this.endpoint = 'https://secure.nmi.com/api/transact.php';
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

      const amountFormatted = (amount / 100).toFixed(2);

      const params = new URLSearchParams({
        type: 'sale',
        security_key: this.apiKey,
        ccnumber: paymentMethod.cardNumber!,
        ccexp: paymentMethod.cardExpiry!.replace('/', ''),
        cvv: paymentMethod.cardCvv!,
        amount: amountFormatted,
        currency: currency.toUpperCase(),
        first_name: paymentMethod.billingName?.split(' ')[0] || '',
        last_name: paymentMethod.billingName?.split(' ').slice(1).join(' ') || '',
        email: paymentMethod.email || '',
        ...Object.entries(metadata).reduce((acc, [key, value]) => ({
          ...acc,
          [`orderid_${key}`]: value,
        }), {}),
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const text = await response.text();
      const result = this.parseNMIResponse(text);

      if (result.response === '1') {
        return {
          success: true,
          transactionId: result.transactionid!,
          processor: this.processorName,
          amount,
          currency,
          metadata: {
            authCode: result.authcode || '',
            avsResponse: result.avsresponse || '',
            cvvResponse: result.cvvresponse || '',
          },
        };
      }

      return {
        success: false,
        processor: this.processorName,
        errorMessage: result.responsetext || 'Payment declined',
        errorCode: this.mapNMIErrorCode(result.response_code),
      };
    } catch (error) {
      logger.error('PaymentCloud payment processing failed', error as Error, {
        processor: this.processorName,
        amount,
        currency,
      });

      return {
        success: false,
        processor: this.processorName,
        errorMessage: (error as Error).message,
        errorCode: 'PROCESSOR_ERROR',
      };
    }
  }

  async refund(
    transactionId: string,
    amount?: number,
    reason?: string
  ): Promise<RefundResult> {
    try {
      const params = new URLSearchParams({
        type: 'refund',
        security_key: this.apiKey,
        transactionid: transactionId,
        ...(amount && { amount: (amount / 100).toFixed(2) }),
      });

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      const text = await response.text();
      const result = this.parseNMIResponse(text);

      if (result.response === '1') {
        return {
          success: true,
          refundId: result.transactionid!,
          processor: this.processorName,
          amount: amount || 0,
          status: 'succeeded',
        };
      }

      return {
        success: false,
        processor: this.processorName,
        errorMessage: result.responsetext || 'Refund failed',
      };
    } catch (error) {
      logger.error('PaymentCloud refund failed', error as Error, {
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
      const params = new URLSearchParams({
        type: 'validate',
        security_key: this.apiKey,
      });

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      return {
        healthy: response.ok,
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

  private parseNMIResponse(text: string): Record<string, string> {
    const params = new URLSearchParams(text);
    const result: Record<string, string> = {};
    params.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  private mapNMIErrorCode(code?: string): string {
    const errorMap: Record<string, string> = {
      '2': 'DECLINED',
      '3': 'ERROR',
      '100': 'INVALID_TRANSACTION',
      '200': 'INVALID_CARD',
      '201': 'EXPIRED_CARD',
      '202': 'INSUFFICIENT_FUNDS',
      '203': 'CARD_LIMIT_EXCEEDED',
      '204': 'CARD_NOT_ACTIVATED',
      '220': 'FRAUD_DETECTED',
      '240': 'CALL_ISSUER',
      '250': 'PICKUP_CARD',
      '251': 'LOST_CARD',
      '252': 'STOLEN_CARD',
      '260': 'SOFT_DECLINE',
      '261': 'HARD_DECLINE',
      '300': 'PROCESSOR_ERROR',
      '400': 'HOLD_CALL',
      '410': 'INVALID_MERCHANT',
      '420': 'INVALID_AMOUNT',
      '430': 'INVALID_CARD_NUMBER',
      '440': 'INVALID_EXPIRATION',
      '450': 'INVALID_CVV',
      '460': 'INVALID_AVS',
      '500': 'DO_NOT_HONOR',
      '510': 'INSUFFICIENT_FUNDS',
      '520': 'NO_ACCOUNT',
      '530': 'NO_ROUTE',
      '531': 'CVV_FAILURE',
      '532': 'AVS_FAILURE',
      '540': 'INCORRECT_PIN',
      '541': 'EXCEED_WITHDRAW_LIMIT',
      '550': 'RESTRICTED_CARD',
      '560': 'SUSPECTED_FRAUD',
      '570': 'EXCEEDS_LIMIT',
      '580': 'REVOCATION_ALL',
      '590': 'DUPLICATE',
      '591': 'BANK_TIMEOUT',
      '592': 'SYSTEM_ERROR',
    };

    return errorMap[code || ''] || 'UNKNOWN_ERROR';
  }
}
