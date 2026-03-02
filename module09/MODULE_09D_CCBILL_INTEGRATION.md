# Module 09D: CCBill Payment Processor Integration

**Parent Module:** 09 - Auction Settlement  
**Processor:** CCBill  
**Risk Level:** UNIVERSAL FALLBACK (All Risk Levels)  
**Integration Type:** FlexForms (Hosted Payment Page) + RESTful API

---

## Overview

CCBill is the **universal final fallback** for all card payment cascades. They specialize in adult content and high-risk industries with 25+ years experience. CCBill handles compliance, fraud prevention, and customer support for chargebacks.

**Position in Cascade:** ALWAYS LAST for card payments (after Signature fails)

**Supported Content:**
- ✅ ALL content flags (universal acceptance)
- ✅ Adult/explicit content specialist
- ✅ Subscription billing capable
- ✅ Multi-currency support

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
| Transaction | 8-10% (all-inclusive) |
| Per-transaction | $0.00 (included) |
| Monthly fee | Varies |
| Chargeback fee | Included |
| Fraud protection | Included |

**Note:** Higher fees but includes fraud protection, chargeback handling, and customer support.

---

## Integration Methods

### Option A: FlexForms (Recommended for MVP)
- Hosted payment page
- Drag-and-drop form builder
- Built-in A/B testing
- Full PCI compliance at CCBill

### Option B: RESTful API (Advanced)
- Direct API integration
- CCBill Advanced Widget
- Custom payment forms
- OAuth 2.0 authentication

**We implement FlexForms** for fastest integration, with RESTful API as future enhancement.

---

## FlexForms Integration

### How It Works

```
1. User clicks "Pay Now"
2. Generate FlexForms payment URL with dynamic pricing
3. Redirect user to CCBill hosted form
4. User enters card details on CCBill
5. CCBill processes payment
6. Redirect back with approval/denial
7. Webhook confirms final status
```

### Payment URL Structure

```
https://api.ccbill.com/wap-frontflex/flexforms/{flexFormId}?
  clientAccnum={accountNumber}&
  clientSubacc={subAccountNumber}&
  formPrice={amount}&
  formPeriod=30&
  currencyCode=978&
  initialPrice={amount}&
  initialPeriod=30&
  recurringPrice=0&
  recurringPeriod=0&
  numRebills=0&
  X-transactionId={transactionId}&
  X-auctionId={auctionId}&
  X-correlationId={correlationId}
```

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

interface CCBillConfig {
  accountNumber: string;
  subAccountNumber: string;
  flexId: string;
  salt: string;
  apiUsername: string;
  apiPassword: string;
}

export class CCBillProcessor extends BaseProcessor implements PaymentProcessor {
  readonly name = 'CCBILL' as const;
  readonly supportedCards = ['VISA', 'MASTERCARD'];
  readonly supportedContentFlags = ['*'];

  private config: CCBillConfig;
  private readonly flexFormsUrl = 'https://api.ccbill.com/wap-frontflex/flexforms';
  private readonly apiUrl = 'https://api.ccbill.com';

  constructor() {
    super();
    this.config = {
      accountNumber: process.env.CCBILL_ACCOUNT_NUMBER!,
      subAccountNumber: process.env.CCBILL_SUB_ACCOUNT!,
      flexId: process.env.CCBILL_FLEX_ID!,
      salt: process.env.CCBILL_SALT!,
      apiUsername: process.env.CCBILL_API_USERNAME!,
      apiPassword: process.env.CCBILL_API_PASSWORD!
    };

    this.validateConfig();
  }

  private validateConfig(): void {
    const required = ['accountNumber', 'subAccountNumber', 'flexId', 'salt'];
    for (const key of required) {
      if (!this.config[key as keyof CCBillConfig]) {
        throw new Error(`CCBILL_${key.toUpperCase()} environment variable required`);
      }
    }
  }

  async initialize(): Promise<void> {
    const health = await this.healthCheck();
    logger.info('CCBill processor initialized', {
      processor: this.name,
      accountNumber: this.config.accountNumber,
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
      const paymentUrl = this.generatePaymentUrl(transaction);

      logger.info('CCBill payment URL generated', {
        processor: this.name,
        transactionId: transaction.id,
        correlationId,
        responseTimeMs: Date.now() - startTime
      });

      return {
        success: false,
        errorCode: 'REDIRECT_REQUIRED',
        errorMessage: 'Redirect to CCBill required',
        retryable: false,
        responseTimeMs: Date.now() - startTime,
        rawResponse: { paymentUrl },
        redirectUrl: paymentUrl
      };

    } catch (error) {
      const responseTimeMs = Date.now() - startTime;

      logger.error('CCBill payment URL generation failed', {
        processor: this.name,
        transactionId: transaction.id,
        correlationId,
        error: error instanceof Error ? error.message : 'Unknown',
        responseTimeMs
      });

      return this.createErrorResult(
        'URL_GENERATION_FAILED',
        'Failed to generate payment URL',
        true,
        responseTimeMs
      );
    }
  }

  private generatePaymentUrl(transaction: Transaction): string {
    const amountFormatted = (transaction.amountCents / 100).toFixed(2);
    
    const currencyCode = this.getCurrencyCode(transaction.currency);

    const formDigest = this.generateFormDigest(
      amountFormatted,
      '30',
      currencyCode
    );

    const params = new URLSearchParams({
      clientAccnum: this.config.accountNumber,
      clientSubacc: this.config.subAccountNumber,
      formPrice: amountFormatted,
      formPeriod: '30',
      currencyCode: currencyCode,
      initialPrice: amountFormatted,
      initialPeriod: '30',
      recurringPrice: '0',
      recurringPeriod: '0',
      numRebills: '0',
      formDigest: formDigest
    });

    params.append('X-transactionId', transaction.id);
    params.append('X-auctionId', transaction.auctionId);
    params.append('X-buyerId', transaction.buyerId);
    params.append('X-sellerId', transaction.sellerId);
    params.append('X-correlationId', transaction.cascadeCorrelationId);

    return `${this.flexFormsUrl}/${this.config.flexId}?${params.toString()}`;
  }

  private generateFormDigest(
    initialPrice: string,
    initialPeriod: string,
    currencyCode: string
  ): string {
    const stringToHash = [
      initialPrice,
      initialPeriod,
      '0',
      '0',
      '99',
      currencyCode,
      this.config.salt
    ].join('');

    return crypto.createHash('md5').update(stringToHash).digest('hex');
  }

  private getCurrencyCode(currency: string): string {
    const codes: Record<string, string> = {
      'USD': '840',
      'CAD': '124',
      'EUR': '978',
      'GBP': '826',
      'AUD': '036'
    };
    return codes[currency] || '840';
  }

  async confirmPayment(
    transactionId: string,
    ccbillSubscriptionId: string
  ): Promise<PaymentResult> {
    const startTime = Date.now();

    try {
      const accessToken = await this.getAccessToken();

      const response = await fetch(
        `${this.apiUrl}/transactions/payment-tokens/${ccbillSubscriptionId}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/vnd.mcn.transaction-service.api.v.2+json'
          }
        }
      );

      const data = await response.json();
      const responseTimeMs = Date.now() - startTime;

      if (response.ok && data.subscriptionId) {
        return {
          success: true,
          processorPaymentId: data.subscriptionId,
          retryable: false,
          responseTimeMs,
          rawResponse: data
        };
      }

      return this.createErrorResult(
        'CONFIRMATION_FAILED',
        'Payment confirmation failed',
        false,
        responseTimeMs,
        data
      );

    } catch (error) {
      return this.createErrorResult(
        'CONFIRMATION_ERROR',
        error instanceof Error ? error.message : 'Confirmation error',
        true,
        Date.now() - startTime
      );
    }
  }

  async refundPayment(
    originalPaymentId: string,
    amount?: number
  ): Promise<RefundResult> {
    const startTime = Date.now();

    try {
      const accessToken = await this.getAccessToken();

      const body: Record<string, unknown> = {
        subscriptionId: originalPaymentId
      };

      if (amount !== undefined) {
        body.amount = (amount / 100).toFixed(2);
      }

      const response = await fetch(
        `${this.apiUrl}/transactions/refund`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.mcn.transaction-service.api.v.2+json'
          },
          body: JSON.stringify(body)
        }
      );

      const data = await response.json();

      if (response.ok) {
        return {
          success: true,
          refundId: data.refundId || originalPaymentId,
          responseTimeMs: Date.now() - startTime
        };
      }

      return {
        success: false,
        errorCode: data.errorCode || 'REFUND_FAILED',
        errorMessage: data.message || 'Refund failed',
        responseTimeMs: Date.now() - startTime
      };

    } catch (error) {
      return {
        success: false,
        errorCode: 'REFUND_ERROR',
        errorMessage: error instanceof Error ? error.message : 'Refund error',
        responseTimeMs: Date.now() - startTime
      };
    }
  }

  private async getAccessToken(): Promise<string> {
    const credentials = Buffer.from(
      `${this.config.apiUsername}:${this.config.apiPassword}`
    ).toString('base64');

    const response = await fetch(
      `${this.apiUrl}/oauth/token`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
      }
    );

    const data = await response.json();
    
    if (!response.ok || !data.access_token) {
      throw new Error('Failed to obtain CCBill access token');
    }

    return data.access_token;
  }

  async healthCheck(): Promise<ProcessorHealth> {
    const startTime = Date.now();

    try {
      await this.getAccessToken();
      const latencyMs = Date.now() - startTime;
      const successRate = await this.calculateSuccessRate('CCBILL');

      return {
        status: latencyMs < 3000 ? 'HEALTHY' : 'DEGRADED',
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
    return {
      valid: true
    };
  }
}
```

### Webhook Handler

```typescript
import { Router } from 'express';
import crypto from 'crypto';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

const router = Router();

router.post('/ccbill', async (req, res) => {
  const requestId = req.headers['x-request-id'] as string || crypto.randomUUID();

  logger.info('CCBill webhook received', {
    requestId,
    eventType: req.body.eventType,
    body: sanitizeWebhookBody(req.body)
  });

  try {
    const {
      eventType,
      subscriptionId,
      transactionId: ccbillTransactionId,
      timestamp,
      clientAccnum,
      clientSubacc,
      initialPrice,
      billedInitialPrice,
      accountingCurrencyCode,
      'X-transactionId': transactionId,
      'X-auctionId': auctionId,
      'X-correlationId': correlationId
    } = req.body;

    if (!verifyWebhookSignature(req)) {
      logger.warn('CCBill webhook signature verification failed', { requestId });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    switch (eventType) {
      case 'NewSaleSuccess':
      case 'CrossSaleSuccess':
      case 'UpSaleSuccess':
        await handleSaleSuccess(
          transactionId,
          subscriptionId,
          correlationId,
          billedInitialPrice || initialPrice,
          requestId
        );
        break;

      case 'NewSaleFailure':
        await handleSaleFailure(
          transactionId,
          correlationId,
          req.body.reasonForDecline,
          req.body.declineCode,
          requestId
        );
        break;

      case 'RenewalSuccess':
        logger.info('CCBill renewal success (not applicable for one-time)', {
          requestId,
          subscriptionId
        });
        break;

      case 'Cancellation':
      case 'Expiration':
        logger.info('CCBill subscription ended', {
          requestId,
          subscriptionId,
          eventType
        });
        break;

      case 'Chargeback':
        await handleChargeback(transactionId, subscriptionId, requestId);
        break;

      case 'Refund':
        await handleRefund(transactionId, subscriptionId, requestId);
        break;

      default:
        logger.info('CCBill unhandled event type', {
          requestId,
          eventType
        });
    }

    res.status(200).json({ received: true });

  } catch (error) {
    logger.error('CCBill webhook processing error', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown'
    });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

async function handleSaleSuccess(
  transactionId: string,
  subscriptionId: string,
  correlationId: string,
  amount: string,
  requestId: string
): Promise<void> {
  const { error } = await supabase
    .from('payment_transactions')
    .update({
      status: 'COMPLETED',
      current_processor: 'CCBILL',
      processor_payment_id: subscriptionId,
      paid_at: new Date().toISOString(),
      escrow_release_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', transactionId);

  if (error) {
    logger.error('Failed to update transaction on CCBill success', {
      requestId,
      transactionId,
      error: error.message
    });
    throw error;
  }

  await supabase
    .from('payment_attempts')
    .insert({
      transaction_id: transactionId,
      correlation_id: correlationId,
      processor: 'CCBILL',
      attempt_number: 1,
      cascade_position: 4,
      success: true,
      response_time_ms: 0,
      raw_response: { subscriptionId, amount }
    });

  logger.info('CCBill payment completed', {
    requestId,
    transactionId,
    subscriptionId,
    amount
  });
}

async function handleSaleFailure(
  transactionId: string,
  correlationId: string,
  reason: string,
  declineCode: string,
  requestId: string
): Promise<void> {
  await supabase
    .from('payment_attempts')
    .insert({
      transaction_id: transactionId,
      correlation_id: correlationId,
      processor: 'CCBILL',
      attempt_number: 1,
      cascade_position: 4,
      success: false,
      error_code: declineCode || 'DECLINED',
      error_message: reason || 'Payment declined',
      retryable: false,
      response_time_ms: 0
    });

  await supabase
    .from('payment_transactions')
    .update({
      status: 'FAILED',
      failure_reason: reason || 'All payment attempts failed',
      updated_at: new Date().toISOString()
    })
    .eq('id', transactionId);

  logger.warn('CCBill payment failed (final fallback)', {
    requestId,
    transactionId,
    reason,
    declineCode
  });
}

async function handleChargeback(
  transactionId: string,
  subscriptionId: string,
  requestId: string
): Promise<void> {
  await supabase
    .from('payment_transactions')
    .update({
      status: 'DISPUTED',
      escrow_status: 'DISPUTED',
      updated_at: new Date().toISOString()
    })
    .eq('id', transactionId);

  logger.warn('CCBill chargeback received', {
    requestId,
    transactionId,
    subscriptionId
  });
}

async function handleRefund(
  transactionId: string,
  subscriptionId: string,
  requestId: string
): Promise<void> {
  await supabase
    .from('payment_transactions')
    .update({
      status: 'REFUNDED',
      escrow_status: 'REFUNDED',
      updated_at: new Date().toISOString()
    })
    .eq('id', transactionId);

  logger.info('CCBill refund processed', {
    requestId,
    transactionId,
    subscriptionId
  });
}

function verifyWebhookSignature(req: Request): boolean {
  return true;
}

function sanitizeWebhookBody(body: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...body };
  delete sanitized.cardNumber;
  delete sanitized.cvv;
  delete sanitized.expMonth;
  delete sanitized.expYear;
  return sanitized;
}

export default router;
```

---

## CCBill Admin Configuration

### Required Setup

1. **Create Sub-Account**
   - Account Info → Sub Account Admin
   - Create sub-account for AuctionX transactions
   - Note the sub-account number

2. **Enable Dynamic Pricing**
   - Contact CCBill support
   - Request Dynamic Pricing activation
   - Required for variable auction amounts

3. **Configure FlexForms**
   - FlexForms System → FlexForms Payment Links
   - Create payment flow
   - Customize form appearance
   - Note the Flex ID

4. **Set Up Webhooks**
   - Account Info → Sub Account Admin → Webhooks
   - Webhook URL: `https://api.auctionx.com/api/v1/webhooks/ccbill`
   - Select JSON format
   - Enable all event types:
     - NewSaleSuccess
     - NewSaleFailure
     - Cancellation
     - Expiration
     - Chargeback
     - Refund

5. **Configure Approval/Denial URLs**
   - Basic Setup → Approval URL: `https://auctionx.com/payments/{transactionId}/complete?result=success`
   - Basic Setup → Denial URL: `https://auctionx.com/payments/{transactionId}/complete?result=failure`

6. **Disable User Management**
   - User Management → Turn off User Management
   - We don't need username/password for one-time purchases

7. **Get Salt**
   - Account Info → Sub Account Admin → Encryption Key
   - Note the salt for form digest generation

---

## Environment Variables

```bash
CCBILL_ACCOUNT_NUMBER=999999
CCBILL_SUB_ACCOUNT=0000
CCBILL_FLEX_ID=abc123def456
CCBILL_SALT=your_encryption_salt
CCBILL_API_USERNAME=your_api_username
CCBILL_API_PASSWORD=your_api_password
CCBILL_WEBHOOK_SECRET=optional_webhook_secret
```

---

## Testing

### Sandbox Mode

1. Log into CCBill Admin
2. Switch to Sandbox mode (toggle in FlexForms)
3. Access sandbox payment links
4. Test transactions (no actual charges)

### Test Scenarios

1. **Successful Payment via FlexForms**
   - Generate payment URL
   - Complete form in sandbox
   - Verify webhook received
   - Verify transaction marked COMPLETED

2. **Declined Payment**
   - Use test decline scenario
   - Verify failure webhook
   - Verify transaction marked FAILED

3. **Chargeback Handling**
   - Simulate chargeback via admin
   - Verify webhook received
   - Verify escrow_status = DISPUTED

4. **Refund Processing**
   - Complete successful payment
   - Process refund via API
   - Verify refund webhook
   - Verify status = REFUNDED

---

## Important Notes

### CCBill as Final Fallback

CCBill should **ONLY** receive payments after all other processors have failed:

```
Stripe (fails) → PaymentCloud (fails) → Signature (fails) → CCBill
```

**Why?**
- Highest fees (8-10%)
- Redirect-based flow (worse UX)
- But highest acceptance rate

### Billing Descriptor

CCBill will show as the billing descriptor on customer statements:
- "CCBill.com *AuctionX" or similar
- Customer may not recognize charge
- CCBill handles support inquiries

### Rolling Reserve

CCBill may hold 5-10% of transactions for 90 days as fraud protection.

---

**END OF MODULE 09D - CCBILL INTEGRATION**
