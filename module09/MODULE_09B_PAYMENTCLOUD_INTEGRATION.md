# Module 09B: PaymentCloud Payment Processor Integration

**Parent Module:** 09 - Auction Settlement  
**Processor:** PaymentCloud (via NMI Gateway)  
**Risk Level:** MEDIUM  
**Integration Type:** NMI Gateway API (Direct Post or Three-Step Redirect)

---

## Overview

PaymentCloud is the primary processor for medium-risk Unmentionables SFW content. They specialize in high-risk merchant accounts and use the NMI (Network Merchants Inc.) gateway infrastructure.

**Supported Content Flags:**
- `CREATOR_MERCH`
- `COSPLAY`
- `GAMING`
- `COLLECTIBLES`

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
| Transaction | 2.7-4.3% (tiered) |
| Per-transaction | $0.15-$0.75 |
| Monthly fee | $10-$50 |
| Network registration | $1,450 (Visa $950 + MC $500) |
| Rolling reserve | 5-20% held for 90-180 days |

---

## NMI Gateway Integration

PaymentCloud uses NMI as their gateway provider. Two integration methods available:

### Option A: Direct Post API (Recommended)
- Card data posted directly to NMI
- Lower PCI scope for merchant
- Faster checkout experience

### Option B: Three-Step Redirect
- User redirected to hosted payment page
- Highest security (full PCI compliance at NMI)
- Branded payment pages available

**We will use Direct Post API** for better UX while maintaining PCI compliance through tokenization.

---

## Implementation

### Processor Class

```typescript
import crypto from 'crypto';
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

export class PaymentCloudProcessor extends BaseProcessor implements PaymentProcessor {
  readonly name = 'PAYMENTCLOUD' as const;
  readonly supportedCards = ['VISA', 'MASTERCARD'];
  readonly supportedContentFlags = [
    'CREATOR_MERCH',
    'COSPLAY',
    'GAMING',
    'COLLECTIBLES'
  ];

  private readonly apiUrl = 'https://secure.nmi.com/api/transact.php';
  private readonly queryUrl = 'https://secure.nmi.com/api/query.php';
  private securityKey: string;

  constructor() {
    super();
    this.securityKey = process.env.PAYMENTCLOUD_SECURITY_KEY!;
    
    if (!this.securityKey) {
      throw new Error('PAYMENTCLOUD_SECURITY_KEY environment variable required');
    }
  }

  async initialize(): Promise<void> {
    const health = await this.healthCheck();
    logger.info('PaymentCloud processor initialized', {
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
        security_key: this.securityKey,
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
        order_description: `AuctionX Transaction ${transaction.id}`,
        
        merchant_defined_field_1: transaction.auctionId,
        merchant_defined_field_2: correlationId,
        merchant_defined_field_3: transaction.buyerId
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
        logger.info('PaymentCloud payment succeeded', {
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

      logger.warn('PaymentCloud payment failed', {
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
        logger.warn('PaymentCloud payment timeout', {
          processor: this.name,
          transactionId: transaction.id,
          correlationId,
          responseTimeMs
        });

        return this.createErrorResult(
          'PROCESSOR_TIMEOUT',
          'Payment processor timeout',
          true,
          responseTimeMs
        );
      }

      logger.error('PaymentCloud unknown error', {
        processor: this.name,
        transactionId: transaction.id,
        correlationId,
        error: error instanceof Error ? error.message : 'Unknown',
        responseTimeMs
      });

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
        security_key: this.securityKey,
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
        security_key: this.securityKey,
        type: 'validate'
      });

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString(),
        signal: AbortSignal.timeout(5000)
      });

      const latencyMs = Date.now() - startTime;
      const successRate = await this.calculateSuccessRate('PAYMENTCLOUD');

      if (response.ok) {
        return {
          status: latencyMs < 2000 ? 'HEALTHY' : 'DEGRADED',
          latencyMs,
          successRate24h: successRate,
          checkedAt: new Date()
        };
      }

      return {
        status: 'DEGRADED',
        latencyMs,
        successRate24h: successRate,
        lastError: `HTTP ${response.status}`,
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
    if (!paymentMethod.cardNumber) {
      return {
        valid: false,
        errorCode: 'MISSING_CARD_NUMBER',
        errorMessage: 'Card number is required'
      };
    }

    const cardNumber = paymentMethod.cardNumber.replace(/\s/g, '');
    
    if (!this.luhnCheck(cardNumber)) {
      return {
        valid: false,
        errorCode: 'INVALID_CARD_NUMBER',
        errorMessage: 'Card number is invalid'
      };
    }

    const brand = this.detectCardBrand(cardNumber);
    if (!this.supportedCards.includes(brand)) {
      return {
        valid: false,
        errorCode: 'UNSUPPORTED_CARD_BRAND',
        errorMessage: `${brand} cards are not supported`
      };
    }

    if (!paymentMethod.cardExpiry || !/^\d{4}$/.test(paymentMethod.cardExpiry)) {
      return {
        valid: false,
        errorCode: 'INVALID_EXPIRY',
        errorMessage: 'Card expiry must be MMYY format'
      };
    }

    const month = parseInt(paymentMethod.cardExpiry.slice(0, 2));
    const year = parseInt('20' + paymentMethod.cardExpiry.slice(2, 4));
    const now = new Date();
    const expiry = new Date(year, month, 0);

    if (expiry < now) {
      return {
        valid: false,
        errorCode: 'CARD_EXPIRED',
        errorMessage: 'Card has expired'
      };
    }

    if (!paymentMethod.cardCvv || !/^\d{3,4}$/.test(paymentMethod.cardCvv)) {
      return {
        valid: false,
        errorCode: 'INVALID_CVV',
        errorMessage: 'CVV must be 3 or 4 digits'
      };
    }

    return {
      valid: true,
      cardBrand: brand,
      cardLastFour: cardNumber.slice(-4)
    };
  }

  private parseNMIResponse(responseText: string): NMIResponse {
    const params = new URLSearchParams(responseText);
    return {
      response: params.get('response') as '1' | '2' | '3',
      responsetext: params.get('responsetext') || '',
      authcode: params.get('authcode') || undefined,
      transactionid: params.get('transactionid') || undefined,
      avsresponse: params.get('avsresponse') || undefined,
      cvvresponse: params.get('cvvresponse') || undefined,
      orderid: params.get('orderid') || undefined,
      response_code: params.get('response_code') || undefined
    };
  }

  private mapNMIError(response: NMIResponse): {
    code: string;
    message: string;
    retryable: boolean;
  } {
    const responseCode = response.response_code || '';
    const responseText = response.responsetext.toLowerCase();

    const nonRetryableCodes: Record<string, { code: string; message: string }> = {
      '200': { code: 'CARD_DECLINED', message: 'Transaction was declined' },
      '201': { code: 'DO_NOT_HONOR', message: 'Do not honor' },
      '202': { code: 'INSUFFICIENT_FUNDS', message: 'Insufficient funds' },
      '203': { code: 'CARD_OVER_LIMIT', message: 'Over daily limit' },
      '204': { code: 'CARD_RESTRICTED', message: 'Card restricted' },
      '220': { code: 'INVALID_CARD_NUMBER', message: 'Invalid card number' },
      '221': { code: 'CARD_EXPIRED', message: 'Card has expired' },
      '222': { code: 'INVALID_EXPIRY', message: 'Invalid expiration date' },
      '223': { code: 'INVALID_CVV', message: 'Invalid CVV' },
      '224': { code: 'INVALID_CARD_TYPE', message: 'Card type not accepted' },
      '240': { code: 'CALL_ISSUER', message: 'Call card issuer' },
      '250': { code: 'STOLEN_CARD', message: 'Pick up card' },
      '251': { code: 'LOST_CARD', message: 'Lost card' },
      '252': { code: 'FRAUD_SUSPECTED', message: 'Suspected fraud' },
      '260': { code: 'CARD_DECLINED_HARD', message: 'Declined - do not retry' },
      '261': { code: 'CARD_DECLINED_HARD', message: 'Declined - stop all recurring' },
      '262': { code: 'CARD_DECLINED_HARD', message: 'Declined - stop this recurring' }
    };

    if (nonRetryableCodes[responseCode]) {
      return {
        ...nonRetryableCodes[responseCode],
        retryable: false
      };
    }

    const retryableCodes: Record<string, { code: string; message: string }> = {
      '300': { code: 'PROCESSOR_TIMEOUT', message: 'Transaction timeout' },
      '400': { code: 'PROCESSOR_ERROR', message: 'Transaction error' },
      '410': { code: 'INVALID_MERCHANT', message: 'Invalid merchant configuration' },
      '411': { code: 'MERCHANT_RESTRICTED', message: 'Merchant restricted' },
      '420': { code: 'COMMUNICATION_ERROR', message: 'Communication error' },
      '421': { code: 'PROCESSOR_UNAVAILABLE', message: 'Processor unavailable' },
      '430': { code: 'DUPLICATE_TRANSACTION', message: 'Duplicate transaction' }
    };

    if (retryableCodes[responseCode]) {
      return {
        ...retryableCodes[responseCode],
        retryable: true
      };
    }

    if (responseText.includes('decline') || responseText.includes('denied')) {
      return {
        code: 'CARD_DECLINED',
        message: response.responsetext,
        retryable: false
      };
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: response.responsetext || 'Transaction failed',
      retryable: true
    };
  }

  private luhnCheck(cardNumber: string): boolean {
    let sum = 0;
    let isEven = false;

    for (let i = cardNumber.length - 1; i >= 0; i--) {
      let digit = parseInt(cardNumber[i], 10);

      if (isEven) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }

      sum += digit;
      isEven = !isEven;
    }

    return sum % 10 === 0;
  }

  private detectCardBrand(cardNumber: string): string {
    if (/^4/.test(cardNumber)) return 'VISA';
    if (/^5[1-5]/.test(cardNumber) || /^2[2-7]/.test(cardNumber)) return 'MASTERCARD';
    if (/^3[47]/.test(cardNumber)) return 'AMEX';
    if (/^6(?:011|5)/.test(cardNumber)) return 'DISCOVER';
    return 'UNKNOWN';
  }
}
```

### IPN Webhook Handler

```typescript
import { Router } from 'express';
import crypto from 'crypto';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

const router = Router();

router.post('/paymentcloud', async (req, res) => {
  const requestId = req.headers['x-request-id'] as string || crypto.randomUUID();

  logger.info('PaymentCloud IPN received', {
    requestId,
    body: req.body
  });

  try {
    const {
      action,
      orderid,
      transactionid,
      response,
      responsetext,
      response_code,
      amount,
      merchant_defined_field_1: auctionId,
      merchant_defined_field_2: correlationId
    } = req.body;

    if (!orderid) {
      logger.warn('PaymentCloud IPN missing orderid', { requestId });
      return res.status(200).send('OK');
    }

    const transactionResult = await supabase
      .from('payment_transactions')
      .select('id, status')
      .eq('id', orderid)
      .single();

    if (!transactionResult.data) {
      logger.warn('PaymentCloud IPN for unknown transaction', {
        requestId,
        orderid
      });
      return res.status(200).send('OK');
    }

    const transaction = transactionResult.data;

    switch (action) {
      case 'sale':
        if (response === '1') {
          await supabase
            .from('payment_transactions')
            .update({
              status: 'COMPLETED',
              processor_payment_id: transactionid,
              paid_at: new Date().toISOString(),
              escrow_release_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', orderid);

          logger.info('PaymentCloud payment completed via IPN', {
            requestId,
            transactionId: orderid,
            nmiTransactionId: transactionid
          });
        } else if (response === '2') {
          await supabase
            .from('payment_attempts')
            .insert({
              transaction_id: orderid,
              correlation_id: correlationId,
              processor: 'PAYMENTCLOUD',
              attempt_number: 1,
              cascade_position: 2,
              success: false,
              error_code: response_code || 'DECLINED',
              error_message: responsetext,
              retryable: false,
              response_time_ms: 0,
              raw_response: req.body
            });

          logger.info('PaymentCloud payment declined via IPN', {
            requestId,
            transactionId: orderid,
            responseCode: response_code
          });
        }
        break;

      case 'refund':
        if (response === '1') {
          await supabase
            .from('payment_transactions')
            .update({
              status: 'REFUNDED',
              escrow_status: 'REFUNDED',
              updated_at: new Date().toISOString()
            })
            .eq('id', orderid);

          logger.info('PaymentCloud refund completed via IPN', {
            requestId,
            transactionId: orderid
          });
        }
        break;

      case 'chargeback':
        await supabase
          .from('payment_transactions')
          .update({
            status: 'DISPUTED',
            escrow_status: 'DISPUTED',
            updated_at: new Date().toISOString()
          })
          .eq('id', orderid);

        logger.warn('PaymentCloud chargeback received', {
          requestId,
          transactionId: orderid,
          amount
        });
        break;

      default:
        logger.info('PaymentCloud IPN unhandled action', {
          requestId,
          action,
          transactionId: orderid
        });
    }

    res.status(200).send('OK');

  } catch (error) {
    logger.error('PaymentCloud IPN processing error', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown'
    });
    res.status(200).send('OK');
  }
});

export default router;
```

---

## Security Considerations

### PCI Compliance

Since we're handling raw card data:
1. Never log full card numbers
2. Use HTTPS for all API calls
3. Don't store card data (process and discard)
4. Consider upgrading to tokenization

### Security Key Management

```typescript
const securityKey = process.env.PAYMENTCLOUD_SECURITY_KEY;

if (!securityKey || securityKey.length < 32) {
  throw new Error('Invalid PAYMENTCLOUD_SECURITY_KEY');
}
```

### Request Validation

```typescript
function validateIPNSource(req: Request): boolean {
  const allowedIPs = [
    '67.207.92.0/24',
    '67.207.93.0/24'
  ];
  
  const clientIP = req.ip;
  return allowedIPs.some(range => isIPInRange(clientIP, range));
}
```

---

## Testing

### NMI Test Credentials

Contact PaymentCloud support for sandbox credentials.

### Test Card Numbers (NMI Standard)

| Scenario | Card Number |
|----------|-------------|
| Success | 4111111111111111 |
| Decline | 4111111111111129 |
| AVS Mismatch | 4111111111111145 |
| CVV Fail | 4111111111111152 |

### Test Scenarios

1. **Successful Sale**
   - Submit sale with test card 4111111111111111
   - Verify response = 1
   - Verify transactionid returned
   - Verify IPN received

2. **Declined Transaction**
   - Submit sale with test card 4111111111111129
   - Verify response = 2
   - Verify appropriate error code
   - Verify cascade triggers

3. **Refund**
   - Complete successful sale
   - Submit refund request
   - Verify refund IPN received

4. **Timeout Handling**
   - Simulate network delay
   - Verify timeout triggers cascade
   - Verify transaction state preserved

---

## Content Restrictions

**PaymentCloud has specific content policies even for high-risk:**

❌ **Prohibited:**
- Bestiality, blood/gore, simulated rape
- "Fantasy" content (cat ears, fairies) - flagged as lolicon concern
- Content featuring anyone appearing under 18

✅ **Allowed:**
- Authentic concert gear, memorabilia
- Creator merchandise (SFW)
- Cosplay costumes and props
- Gaming collectibles

**Marketing Language Critical:**
- ✅ "Authentic concert-worn gear"
- ✅ "Stage-used equipment"  
- ❌ "Sweaty clothing"
- ❌ "Used underwear"
- ❌ "Smells like [person]"

---

## Environment Variables

```bash
PAYMENTCLOUD_SECURITY_KEY=your_nmi_security_key
PAYMENTCLOUD_MERCHANT_ID=your_merchant_id
PAYMENTCLOUD_WEBHOOK_SECRET=optional_shared_secret
```

---

## Error Codes Reference

| NMI Code | Internal Code | Retryable | Description |
|----------|---------------|-----------|-------------|
| 200 | CARD_DECLINED | No | Generic decline |
| 201 | DO_NOT_HONOR | No | Do not honor |
| 202 | INSUFFICIENT_FUNDS | No | Insufficient funds |
| 220 | INVALID_CARD_NUMBER | No | Invalid card |
| 221 | CARD_EXPIRED | No | Expired card |
| 223 | INVALID_CVV | No | Bad CVV |
| 250 | STOLEN_CARD | No | Pick up card |
| 300 | PROCESSOR_TIMEOUT | Yes | Timeout |
| 400 | PROCESSOR_ERROR | Yes | System error |
| 420 | COMMUNICATION_ERROR | Yes | Network issue |

---

**END OF MODULE 09B - PAYMENTCLOUD INTEGRATION**
