# Module 09E: NOWPayments Cryptocurrency Integration

**Parent Module:** 09 - Auction Settlement  
**Processor:** NOWPayments  
**Payment Type:** Cryptocurrency (USDT, USDC, ETH, BTC)  
**Integration Type:** REST API + IPN Webhooks

---

## Overview

NOWPayments provides cryptocurrency payment processing. It is **NOT** a fallback processor but a **user-selected option** at checkout. Buyers explicitly choose "Pay with Crypto" and receive a 72-hour payment window.

**Key Points:**
- 🚫 NOT a cascade fallback
- ✅ User opt-in only
- ⏱️ 72-hour payment window (vs 20min for cards)
- 💱 Supports 300+ cryptocurrencies
- 📱 QR code for mobile wallets

**Preferred Stablecoins:**
- USDT (Tether) - Ethereum or TRON
- USDC (Circle) - Ethereum
- DAI - Ethereum

**Also Supported:**
- Bitcoin (BTC)
- Ethereum (ETH)
- Litecoin (LTC)
- Other major cryptocurrencies

---

## Fee Structure

| Component | Rate |
|-----------|------|
| Transaction | ~0.5-1% |
| Network fees | Paid by buyer |
| Conversion | Optional auto-convert to USDT |
| Withdrawal | Network fee only |

**Significantly lower** than card processing (2.9-10%).

---

## Payment Flow

```
1. User clicks "Pay with Crypto" button
2. Backend creates NOWPayments invoice
3. Display payment page with:
   - QR code
   - Wallet address
   - Amount in selected crypto
   - 72-hour countdown
4. User sends crypto from their wallet
5. NOWPayments detects incoming transaction
6. IPN webhook notifies our backend
7. Wait for blockchain confirmations
8. Final IPN confirms payment complete
9. Release to escrow flow
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

interface NOWPaymentsInvoice {
  id: string;
  order_id: string;
  order_description: string;
  price_amount: number;
  price_currency: string;
  pay_amount: number;
  pay_currency: string;
  pay_address: string;
  ipn_callback_url: string;
  invoice_url: string;
  created_at: string;
  updated_at: string;
  purchase_id: string;
  payment_status: string;
  outcome_amount?: number;
  outcome_currency?: string;
}

interface NOWPaymentsStatus {
  payment_id: string;
  payment_status: string;
  pay_address: string;
  price_amount: number;
  price_currency: string;
  pay_amount: number;
  pay_currency: string;
  actually_paid: number;
  outcome_amount: number;
  outcome_currency: string;
}

export class NOWPaymentsProcessor extends BaseProcessor implements PaymentProcessor {
  readonly name = 'NOWPAYMENTS' as const;
  readonly supportedCards = [];
  readonly supportedContentFlags = ['*'];

  private readonly apiUrl = 'https://api.nowpayments.io/v1';
  private apiKey: string;
  private ipnSecret: string;

  constructor() {
    super();
    this.apiKey = process.env.NOWPAYMENTS_API_KEY!;
    this.ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET!;

    if (!this.apiKey) {
      throw new Error('NOWPAYMENTS_API_KEY environment variable required');
    }
  }

  async initialize(): Promise<void> {
    const health = await this.healthCheck();
    logger.info('NOWPayments processor initialized', {
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
      if (paymentMethod.type !== 'CRYPTO') {
        return this.createErrorResult(
          'INVALID_PAYMENT_METHOD',
          'Crypto payment method required',
          false,
          Date.now() - startTime
        );
      }

      const invoice = await this.createInvoice(transaction, paymentMethod);
      const responseTimeMs = Date.now() - startTime;

      logger.info('NOWPayments invoice created', {
        processor: this.name,
        transactionId: transaction.id,
        correlationId,
        invoiceId: invoice.id,
        payAddress: invoice.pay_address,
        payCurrency: invoice.pay_currency,
        payAmount: invoice.pay_amount,
        responseTimeMs
      });

      return {
        success: true,
        processorPaymentId: invoice.id,
        retryable: false,
        responseTimeMs,
        rawResponse: invoice,
        cryptoPaymentDetails: {
          invoiceId: invoice.id,
          payAddress: invoice.pay_address,
          payAmount: invoice.pay_amount,
          payCurrency: invoice.pay_currency,
          invoiceUrl: invoice.invoice_url,
          qrCodeUrl: `https://api.nowpayments.io/v1/payment/${invoice.id}/qr`
        }
      };

    } catch (error) {
      const responseTimeMs = Date.now() - startTime;

      logger.error('NOWPayments invoice creation failed', {
        processor: this.name,
        transactionId: transaction.id,
        correlationId,
        error: error instanceof Error ? error.message : 'Unknown',
        responseTimeMs
      });

      return this.createErrorResult(
        'INVOICE_CREATION_FAILED',
        error instanceof Error ? error.message : 'Failed to create crypto invoice',
        true,
        responseTimeMs
      );
    }
  }

  private async createInvoice(
    transaction: Transaction,
    paymentMethod: PaymentMethod
  ): Promise<NOWPaymentsInvoice> {
    const priceAmount = transaction.amountCents / 100;
    const priceCurrency = transaction.currency.toLowerCase();
    const payCurrency = paymentMethod.cryptoCurrency || 'usdttrc20';

    const callbackUrl = `${process.env.API_BASE_URL}/api/v1/webhooks/nowpayments`;

    const response = await fetch(`${this.apiUrl}/invoice`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        price_amount: priceAmount,
        price_currency: priceCurrency,
        pay_currency: payCurrency,
        order_id: transaction.id,
        order_description: `AuctionX Payment - Auction ${transaction.auctionId}`,
        ipn_callback_url: callbackUrl,
        success_url: `${process.env.FRONTEND_URL}/payments/${transaction.id}/complete?result=success`,
        cancel_url: `${process.env.FRONTEND_URL}/payments/${transaction.id}/complete?result=cancelled`
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async getPaymentStatus(paymentId: string): Promise<NOWPaymentsStatus> {
    const response = await fetch(`${this.apiUrl}/payment/${paymentId}`, {
      headers: {
        'x-api-key': this.apiKey
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to get payment status: HTTP ${response.status}`);
    }

    return response.json();
  }

  async refundPayment(
    originalPaymentId: string,
    amount?: number
  ): Promise<RefundResult> {
    return {
      success: false,
      errorCode: 'NOT_SUPPORTED',
      errorMessage: 'Crypto refunds must be processed manually',
      responseTimeMs: 0
    };
  }

  async healthCheck(): Promise<ProcessorHealth> {
    const startTime = Date.now();

    try {
      const response = await fetch(`${this.apiUrl}/status`, {
        headers: {
          'x-api-key': this.apiKey
        },
        signal: AbortSignal.timeout(5000)
      });

      const data = await response.json();
      const latencyMs = Date.now() - startTime;
      const successRate = await this.calculateSuccessRate('NOWPAYMENTS');

      if (data.message === 'OK') {
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
        lastError: data.message,
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
    if (paymentMethod.type !== 'CRYPTO') {
      return {
        valid: false,
        errorCode: 'INVALID_TYPE',
        errorMessage: 'Crypto payment method required'
      };
    }

    const supportedCurrencies = await this.getSupportedCurrencies();
    const currency = paymentMethod.cryptoCurrency?.toLowerCase() || 'usdttrc20';

    if (!supportedCurrencies.includes(currency)) {
      return {
        valid: false,
        errorCode: 'UNSUPPORTED_CURRENCY',
        errorMessage: `${currency} is not supported`
      };
    }

    return {
      valid: true
    };
  }

  private async getSupportedCurrencies(): Promise<string[]> {
    try {
      const response = await fetch(`${this.apiUrl}/currencies`, {
        headers: {
          'x-api-key': this.apiKey
        }
      });

      const data = await response.json();
      return data.currencies || [];
    } catch {
      return ['btc', 'eth', 'ltc', 'usdttrc20', 'usdc'];
    }
  }

  verifyIPNSignature(payload: string, signature: string): boolean {
    if (!this.ipnSecret) {
      logger.warn('NOWPayments IPN secret not configured');
      return true;
    }

    const expectedSignature = crypto
      .createHmac('sha512', this.ipnSecret)
      .update(payload)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }
}
```

### IPN Webhook Handler

```typescript
import { Router } from 'express';
import crypto from 'crypto';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { NOWPaymentsProcessor } from '../processors/nowPaymentsProcessor';

const router = Router();
const processor = new NOWPaymentsProcessor();

router.post('/nowpayments', async (req, res) => {
  const requestId = req.headers['x-request-id'] as string || crypto.randomUUID();
  const signature = req.headers['x-nowpayments-sig'] as string;

  logger.info('NOWPayments IPN received', {
    requestId,
    paymentStatus: req.body.payment_status,
    orderId: req.body.order_id
  });

  try {
    const rawBody = JSON.stringify(req.body);
    if (signature && !processor.verifyIPNSignature(rawBody, signature)) {
      logger.warn('NOWPayments IPN signature verification failed', { requestId });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      payment_id,
      payment_status,
      order_id: transactionId,
      pay_address,
      pay_amount,
      pay_currency,
      actually_paid,
      outcome_amount,
      outcome_currency
    } = req.body;

    if (!transactionId) {
      logger.warn('NOWPayments IPN missing order_id', { requestId });
      return res.status(200).json({ received: true });
    }

    switch (payment_status) {
      case 'waiting':
        await handleWaiting(transactionId, payment_id, requestId);
        break;

      case 'confirming':
        await handleConfirming(transactionId, payment_id, actually_paid, requestId);
        break;

      case 'confirmed':
        await handleConfirmed(transactionId, payment_id, requestId);
        break;

      case 'sending':
        await handleSending(transactionId, payment_id, requestId);
        break;

      case 'partially_paid':
        await handlePartiallyPaid(
          transactionId,
          payment_id,
          actually_paid,
          pay_amount,
          requestId
        );
        break;

      case 'finished':
        await handleFinished(
          transactionId,
          payment_id,
          outcome_amount,
          outcome_currency,
          requestId
        );
        break;

      case 'failed':
        await handleFailed(transactionId, payment_id, requestId);
        break;

      case 'refunded':
        await handleRefunded(transactionId, payment_id, requestId);
        break;

      case 'expired':
        await handleExpired(transactionId, payment_id, requestId);
        break;

      default:
        logger.info('NOWPayments unknown status', {
          requestId,
          paymentStatus: payment_status
        });
    }

    res.status(200).json({ received: true });

  } catch (error) {
    logger.error('NOWPayments IPN processing error', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown'
    });
    res.status(500).json({ error: 'IPN processing failed' });
  }
});

async function handleWaiting(
  transactionId: string,
  paymentId: string,
  requestId: string
): Promise<void> {
  await supabase
    .from('payment_transactions')
    .update({
      status: 'AWAITING_CRYPTO',
      crypto_payment_id: paymentId,
      updated_at: new Date().toISOString()
    })
    .eq('id', transactionId);

  logger.info('Crypto payment waiting for funds', {
    requestId,
    transactionId,
    paymentId
  });
}

async function handleConfirming(
  transactionId: string,
  paymentId: string,
  actuallyPaid: number,
  requestId: string
): Promise<void> {
  await supabase
    .from('payment_transactions')
    .update({
      status: 'PROCESSING',
      updated_at: new Date().toISOString()
    })
    .eq('id', transactionId);

  logger.info('Crypto payment confirming', {
    requestId,
    transactionId,
    paymentId,
    actuallyPaid
  });
}

async function handleConfirmed(
  transactionId: string,
  paymentId: string,
  requestId: string
): Promise<void> {
  logger.info('Crypto payment confirmed, waiting for finish', {
    requestId,
    transactionId,
    paymentId
  });
}

async function handleSending(
  transactionId: string,
  paymentId: string,
  requestId: string
): Promise<void> {
  logger.info('Crypto payment sending to merchant', {
    requestId,
    transactionId,
    paymentId
  });
}

async function handlePartiallyPaid(
  transactionId: string,
  paymentId: string,
  actuallyPaid: number,
  expectedAmount: number,
  requestId: string
): Promise<void> {
  logger.warn('Crypto payment partially paid', {
    requestId,
    transactionId,
    paymentId,
    actuallyPaid,
    expectedAmount,
    shortfall: expectedAmount - actuallyPaid
  });
}

async function handleFinished(
  transactionId: string,
  paymentId: string,
  outcomeAmount: number,
  outcomeCurrency: string,
  requestId: string
): Promise<void> {
  const correlationId = crypto.randomUUID();

  const { error } = await supabase
    .from('payment_transactions')
    .update({
      status: 'COMPLETED',
      current_processor: 'NOWPAYMENTS',
      crypto_payment_id: paymentId,
      paid_at: new Date().toISOString(),
      escrow_release_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', transactionId);

  if (error) {
    logger.error('Failed to update transaction on crypto finish', {
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
      processor: 'NOWPAYMENTS',
      attempt_number: 1,
      cascade_position: 0,
      success: true,
      response_time_ms: 0,
      raw_response: { paymentId, outcomeAmount, outcomeCurrency }
    });

  logger.info('Crypto payment completed', {
    requestId,
    transactionId,
    paymentId,
    outcomeAmount,
    outcomeCurrency
  });
}

async function handleFailed(
  transactionId: string,
  paymentId: string,
  requestId: string
): Promise<void> {
  await supabase
    .from('payment_transactions')
    .update({
      status: 'FAILED',
      failure_reason: 'Cryptocurrency payment failed',
      updated_at: new Date().toISOString()
    })
    .eq('id', transactionId);

  logger.warn('Crypto payment failed', {
    requestId,
    transactionId,
    paymentId
  });
}

async function handleRefunded(
  transactionId: string,
  paymentId: string,
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

  logger.info('Crypto payment refunded', {
    requestId,
    transactionId,
    paymentId
  });
}

async function handleExpired(
  transactionId: string,
  paymentId: string,
  requestId: string
): Promise<void> {
  await supabase
    .from('payment_transactions')
    .update({
      status: 'EXPIRED',
      failure_reason: 'Cryptocurrency payment expired',
      updated_at: new Date().toISOString()
    })
    .eq('id', transactionId);

  logger.warn('Crypto payment expired', {
    requestId,
    transactionId,
    paymentId
  });
}

export default router;
```

---

## Frontend Crypto Payment Component

```typescript
import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface CryptoPaymentDetails {
  invoiceId: string;
  payAddress: string;
  payAmount: number;
  payCurrency: string;
  invoiceUrl: string;
}

interface CryptoPaymentProps {
  details: CryptoPaymentDetails;
  deadline: Date;
  onComplete: () => void;
  onExpire: () => void;
}

export function CryptoPayment({
  details,
  deadline,
  onComplete,
  onExpire
}: CryptoPaymentProps) {
  const [copied, setCopied] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<string>('');

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      const diff = deadline.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeRemaining('Expired');
        onExpire();
        clearInterval(interval);
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setTimeRemaining(`${hours}h ${minutes}m ${seconds}s`);
    }, 1000);

    return () => clearInterval(interval);
  }, [deadline, onExpire]);

  const copyAddress = async () => {
    await navigator.clipboard.writeText(details.payAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const currencyDisplay = {
    usdttrc20: 'USDT (TRC-20)',
    usdt: 'USDT (ERC-20)',
    usdc: 'USDC',
    btc: 'Bitcoin',
    eth: 'Ethereum',
    ltc: 'Litecoin'
  }[details.payCurrency.toLowerCase()] || details.payCurrency.toUpperCase();

  return (
    <div className="glass rounded-2xl p-6 max-w-md mx-auto">
      <h2 className="text-xl font-bold text-white mb-4 text-center">
        Pay with {currencyDisplay}
      </h2>

      <div className="bg-white rounded-xl p-4 mb-4">
        <QRCodeSVG
          value={details.payAddress}
          size={200}
          className="mx-auto"
          level="H"
        />
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-sm text-gray-400">Amount</label>
          <div className="text-2xl font-bold text-gradient">
            {details.payAmount} {details.payCurrency.toUpperCase()}
          </div>
        </div>

        <div>
          <label className="text-sm text-gray-400">Send to Address</label>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-dark-600 rounded-lg px-3 py-2 text-sm text-white break-all">
              {details.payAddress}
            </code>
            <button
              onClick={copyAddress}
              className="px-3 py-2 bg-primary-500 rounded-lg text-white text-sm hover:bg-primary-600 transition-colors"
              aria-label="Copy address"
            >
              {copied ? '✓' : 'Copy'}
            </button>
          </div>
        </div>

        <div className="text-center">
          <div className="text-sm text-gray-400">Time Remaining</div>
          <div
            className="text-xl font-mono text-white"
            role="timer"
            aria-live="polite"
          >
            {timeRemaining}
          </div>
        </div>

        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
          <p className="text-sm text-yellow-400">
            ⚠️ Send exactly {details.payAmount} {details.payCurrency.toUpperCase()} to the address above. 
            Sending a different amount or currency may result in lost funds.
          </p>
        </div>

        <a
          href={details.invoiceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-primary-400 hover:text-primary-300 text-sm"
        >
          Open in NOWPayments →
        </a>
      </div>
    </div>
  );
}
```

---

## Environment Variables

```bash
NOWPAYMENTS_API_KEY=your_api_key
NOWPAYMENTS_IPN_SECRET=your_ipn_callback_secret
NOWPAYMENTS_PAYOUT_WALLET=your_usdt_wallet_address
```

---

## Payment Status Flow

```
waiting → confirming → confirmed → sending → finished
                                          ↘ failed
                    ↘ partially_paid
         ↘ expired
```

| Status | Description | Action |
|--------|-------------|--------|
| waiting | Invoice created, awaiting payment | Display QR code |
| confirming | Transaction detected, awaiting confirmations | Show "Confirming..." |
| confirmed | Required confirmations received | Continue waiting |
| sending | Sending to merchant wallet | Almost done |
| partially_paid | Less than required amount received | Show warning |
| finished | Payment complete | Mark COMPLETED |
| failed | Payment failed | Mark FAILED |
| expired | Payment window expired | Mark EXPIRED |
| refunded | Payment refunded | Mark REFUNDED |

---

## Supported Cryptocurrencies (Recommended)

| Currency | Code | Network | Confirmations | Speed |
|----------|------|---------|---------------|-------|
| USDT | usdttrc20 | TRON | 20 | ~1 min |
| USDT | usdt | Ethereum | 12 | ~3 min |
| USDC | usdc | Ethereum | 12 | ~3 min |
| Bitcoin | btc | Bitcoin | 2 | ~20 min |
| Ethereum | eth | Ethereum | 12 | ~3 min |

**Recommend USDT on TRON** for fastest settlement and lowest fees.

---

## Testing

### Sandbox

NOWPayments provides a sandbox environment for testing.

1. Create sandbox API key at https://account-sandbox.nowpayments.io
2. Use sandbox API URL: `https://api-sandbox.nowpayments.io/v1`
3. Simulate payments through sandbox dashboard

### Test Scenarios

1. **Successful Payment**
   - Create invoice
   - Simulate payment in sandbox
   - Verify IPN webhooks received
   - Verify transaction marked COMPLETED

2. **Expired Payment**
   - Create invoice
   - Wait for expiration (or set short timeout)
   - Verify expired IPN received
   - Verify transaction marked EXPIRED

3. **Partial Payment**
   - Create invoice
   - Simulate partial amount
   - Verify partially_paid IPN
   - Handle appropriately

---

## Important Notes

### Crypto is NOT a Fallback

Crypto payments are:
- ❌ NOT triggered when card payments fail
- ✅ Explicitly selected by user at checkout
- ✅ Shown as alternative payment option

### 72-Hour Window

Crypto has a longer payment window because:
- Users may need to transfer from exchange
- Network congestion can delay transactions
- Confirmation times vary by cryptocurrency

### Refunds

Crypto refunds must be processed manually:
- Get user's wallet address
- Initiate transfer from merchant wallet
- Track transaction manually

---

**END OF MODULE 09E - NOWPAYMENTS CRYPTO INTEGRATION**
