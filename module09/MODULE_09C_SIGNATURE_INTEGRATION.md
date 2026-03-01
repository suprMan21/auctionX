# Module 09C: Signature Payments Processor Integration

**Parent Module:** 09 - Auction Settlement  
**Processor:** Signature Payments (NMI/Innovio Gateway)  
**Risk Level:** HIGH  
**Integration Type:** NMI Gateway API (same as PaymentCloud) OR Innovio Gateway

---

## Overview

Signature Payments is positioned as the high-risk specialist before CCBill in the cascade. They have 25+ years experience with adult content, firearms, gambling, and other high-risk verticals. They use either NMI gateway or their proprietary Innovio gateway.

**Supported Content Flags:**
- `ADULT_CONTENT`
- `NSFW`
- `18_PLUS`
- `EXPLICIT`
- All medium-risk flags (fallback from PaymentCloud)

**Card Networks:**
- ✅ Visa
- ✅ Mastercard
- ✅ Visa Debit
- ✅ Mastercard Debit
- ❌ American Express

---

## Fee Structure

| Component | Rate |
|-----------|------|
| Transaction | 4-6% (negotiated) |
| Per-transaction | $0.30 |
| Monthly fee | $25-$100 |
| Chargeback fee | $25-$50 |
| Rolling reserve | 10-20% for 90-180 days |

---

## Gateway Options

### Option A: NMI Gateway (Recommended)
Same integration as PaymentCloud - reuse code with different credentials.

### Option B: Innovio Gateway (Proprietary)
Signature's proprietary gateway with enhanced fraud tools.

**We will implement NMI** for code reuse, with Innovio as future enhancement.

---

## Implementation

### Processor Class

```typescript
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

interface NMIResponse {
  response: '1' | '2' | '3';
  responsetext: string;
  authcode?: string;
  transactionid?: string;
  avsresponse?: string;
  cvvresponse?: string;
  orderid?: string;
  response_code?: string;
}

export class SignatureProcessor extends BaseProcessor implements PaymentProcessor {
  readonly name = 'SIGNATURE' as const;
  readonly supportedCards = ['VISA', 'MASTERCARD'];
  readonly supportedContentFlags = [
    'ADULT_CONTENT',
    'NSFW',
    '18_PLUS',
    'EXPLICIT',
    'CREATOR_MERCH',
    'COSPLAY',
    'GAMING',
    'COLLECTIBLES'
  ];

  private readonly apiUrl = 'https://secure.nmi.com/api/transact.php';
  private apiKey: string;
  private apiSecret: string;

  constructor() {
    super();
    this.apiKey = process.env.SIGNATURE_API_KEY!;
    this.apiSecret = process.env.SIGNATURE_API_SECRET!;
    
    if (!this.apiKey || !this.apiSecret) {
      throw new Error('SIGNATURE_API_KEY and SIGNATURE_API_SECRET required');
    }
  }

  async initialize(): Promise<void> {
    const health = await this.healthCheck();
    logger.info('Signature Payments processor initialized', {
      processor: this.name,
      status: health.status
    });
  }

  async processPayment(
    transaction: Transaction,
    paymentMethod: PaymentMethod
  ): Promise<PaymentResult> {
    const startTime = Date.now();
    const correlationId = transaction.cascadeCorrelationId;

    try {
      if (paymentMethod.type !== 'CARD') {
        return this.createErrorResult(
          'INVALID_PAYMENT_METHOD',
          'Card payment method required',
          false,
          Date.now() - startTime
        );
      }

      const params = new URLSearchParams({
        security_key: this.apiKey,
        type: 'sale',
        amount: (transaction.amountCents / 100).toFixed(2),
        currency: transaction.currency,
        
        ccnumber: paymentMethod.cardNumber!,
        ccexp: paymentMethod.cardExpiry!,
        cvv: paymentMethod.cardCvv!,
        
        first_name: paymentMethod.billingName?.split(' ')[0] || '',
        last_name: paymentMethod.billingName?.split(' ').slice(1).join(' ') || '',
        address1: paymentMethod.billingAddress?.line1 || '',
        city: paymentMethod.billingAddress?.city || '',
        state: paymentMethod.billingAddress?.state || '',
        zip: paymentMethod.billingAddress?.postalCode || '',
        country: paymentMethod.billingAddress?.country || 'CA',
        email: paymentMethod.email || '',
        
        orderid: transaction.id,
        order_description: `Unmentionables Transaction ${transaction.id}`,
        
        merchant_defined_field_1: transaction.auctionId,
        merchant_defined_field_2: correlationId,
        merchant_defined_field_3: transaction.buyerId,
        merchant_defined_field_4: transaction.contentFlags.join(',')
      });

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString(),
        signal: AbortSignal.timeout(30000)
      });

      const responseText = await response.text();
      const nmiResponse = this.parseNMIResponse(responseText);
      const responseTimeMs = Date.now() - startTime;

      if (nmiResponse.response === '1') {
        logger.info('Signature payment succeeded', {
          processor: this.name,
          transactionId: transaction.id,
          correlationId,
          nmiTransactionId: nmiResponse.transactionid,
          authCode: nmiResponse.authcode,
          responseTimeMs
        });

        return {
          success: true,
          processorPaymentId: nmiResponse.transactionid,
          retryable: false,
          responseTimeMs,
          rawResponse: nmiResponse
        };
      }

      const errorMapping = this.mapNMIError(nmiResponse);

      logger.warn('Signature payment failed', {
        processor: this.name,
        transactionId: transaction.id,
        correlationId,
        errorCode: errorMapping.code,
        responseCode: nmiResponse.response_code,
        responseText: nmiResponse.responsetext,
        responseTimeMs
      });

      return this.createErrorResult(
        errorMapping.code,
        errorMapping.message,
        errorMapping.retryable,
        responseTimeMs,
        nmiResponse
      );

    } catch (error) {
      const responseTimeMs = Date.now() - startTime;

      if (error instanceof Error && error.name === 'TimeoutError') {
        return this.createErrorResult(
          'PROCESSOR_TIMEOUT',
          'Payment processor timeout',
          true,
          responseTimeMs
        );
      }

      return this.createErrorResult(
        'PROCESSOR_ERROR',
        'Payment processor error',
        true,
        responseTimeMs
      );
    }
  }

  async refundPayment(
    originalPaymentId: string,
    amount?: number
  ): Promise<RefundResult> {
    const startTime = Date.now();

    try {
      const params = new URLSearchParams({
        security_key: this.apiKey,
        type: 'refund',
        transactionid: originalPaymentId
      });

      if (amount !== undefined) {
        params.append('amount', (amount / 100).toFixed(2));
      }

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      });

      const responseText = await response.text();
      const nmiResponse = this.parseNMIResponse(responseText);

      if (nmiResponse.response === '1') {
        return {
          success: true,
          refundId: nmiResponse.transactionid,
          responseTimeMs: Date.now() - startTime
        };
      }

      return {
        success: false,
        errorCode: nmiResponse.response_code || 'REFUND_FAILED',
        errorMessage: nmiResponse.responsetext,
        responseTimeMs: Date.now() - startTime
      };

    } catch (error) {
      return {
        success: false,
        errorCode: 'REFUND_ERROR',
        errorMessage: error instanceof Error ? error.message : 'Refund failed',
        responseTimeMs: Date.now() - startTime
      };
    }
  }

  async healthCheck(): Promise<ProcessorHealth> {
    const startTime = Date.now();

    try {
      const params = new URLSearchParams({
        security_key: this.apiKey,
        type: 'validate'
      });

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: AbortSignal.timeout(5000)
      });

      const latencyMs = Date.now() - startTime;
      const successRate = await this.calculateSuccessRate('SIGNATURE');

      return {
        status: response.ok ? (latencyMs < 2000 ? 'HEALTHY' : 'DEGRADED') : 'DEGRADED',
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

  async validatePaymentMethod(paymentMethod: PaymentMethod): Promise<ValidationResult> {
    if (!paymentMethod.cardNumber) {
      return { valid: false, errorCode: 'MISSING_CARD_NUMBER', errorMessage: 'Card number required' };
    }

    const cardNumber = paymentMethod.cardNumber.replace(/\s/g, '');
    const brand = this.detectCardBrand(cardNumber);
    
    if (!this.supportedCards.includes(brand)) {
      return { valid: false, errorCode: 'UNSUPPORTED_CARD', errorMessage: `${brand} not supported` };
    }

    return { valid: true, cardBrand: brand, cardLastFour: cardNumber.slice(-4) };
  }

  private parseNMIResponse(responseText: string): NMIResponse {
    const params = new URLSearchParams(responseText);
    return {
      response: params.get('response') as '1' | '2' | '3',
      responsetext: params.get('responsetext') || '',
      authcode: params.get('authcode') || undefined,
      transactionid: params.get('transactionid') || undefined,
      response_code: params.get('response_code') || undefined
    };
  }

  private mapNMIError(response: NMIResponse): { code: string; message: string; retryable: boolean } {
    const nonRetryable = ['200', '201', '202', '220', '221', '223', '250', '252'];
    return {
      code: response.response_code || 'UNKNOWN_ERROR',
      message: response.responsetext || 'Transaction failed',
      retryable: !nonRetryable.includes(response.response_code || '')
    };
  }

  private detectCardBrand(cardNumber: string): string {
    if (/^4/.test(cardNumber)) return 'VISA';
    if (/^5[1-5]/.test(cardNumber) || /^2[2-7]/.test(cardNumber)) return 'MASTERCARD';
    return 'UNKNOWN';
  }
}
```

---

## Industries Served

Signature specializes in high-risk verticals:
- ✅ Adult entertainment
- ✅ Firearms & ammunition
- ✅ Online dating
- ✅ Subscription boxes
- ✅ Gambling/iGaming
- ✅ Digital goods

---

## Environment Variables

```bash
SIGNATURE_API_KEY=your_nmi_security_key
SIGNATURE_API_SECRET=optional_api_secret
SIGNATURE_MERCHANT_ID=your_merchant_id
```

---

**END OF MODULE 09C - SIGNATURE PAYMENTS INTEGRATION**
