# AuctionX - Module 09: Auction Settlement & Payment Processing

**Module:** 09 - Auction Settlement  
**Status:** Starting  
**Prerequisites:** ✅ Modules 01-08 Complete  
**Estimated Duration:** 7-10 days  
**Complexity:** VERY HIGH - 5 processor integrations, cascade routing, admin dashboard  
**WCAG Compliance:** REQUIRED - Maintain AA standards

---

## Module Overview

Build the auction settlement system with modular payment processor architecture. When auctions end, winners must complete payment within a defined window. The system routes payments through appropriate processors based on content flags, cascading through fallbacks on failure.

**Current State:** Auctions can run with real-time bidding  
**Goal:** Winners can complete payment through content-aware processor routing with comprehensive fallback cascade

---

## Architecture Overview

### Core Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                      PAYMENT ORCHESTRATOR                           │
│  - Content flag analysis                                            │
│  - Cascade routing                                                  │
│  - Correlation ID management                                        │
│  - Health monitoring                                                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            │                       │                       │
            ▼                       ▼                       ▼
    ┌───────────────┐     ┌───────────────┐     ┌───────────────┐
    │     STRIPE    │     │  PAYMENTCLOUD │     │   SIGNATURE   │
    │  (Low Risk)   │     │ (Medium Risk) │     │  (High Risk)  │
    │  Visa/MC only │     │  NMI Gateway  │     │  NMI/Innovio  │
    │    2.9%+30¢   │     │    3.5%+30¢   │     │    4-6%+30¢   │
    └───────────────┘     └───────────────┘     └───────────────┘
            │                       │                       │
            └───────────────────────┼───────────────────────┘
                                    │
                                    ▼
                          ┌───────────────┐
                          │    CCBILL     │
                          │  (Universal   │
                          │   Fallback)   │
                          │  FlexForms    │
                          │   8-10%       │
                          └───────────────┘

                    ┌───────────────────────┐
                    │     NOWPAYMENTS      │
                    │   (User-Selected)    │
                    │   USDT/USDC/ETH     │
                    │   72-hour window    │
                    │       ~1%           │
                    └───────────────────────┘
```

### Content Flag Routing

**LOW RISK (AuctionX Brand):**
```
Flags: CONCERT_GEAR, MEMORABILIA, AUTOGRAPHED, SPORTS_EQUIPMENT
Cascade: Stripe → PaymentCloud → Signature → CCBill
Crypto: User opt-in (NOT fallback)
```

**MEDIUM RISK (Unmentionables SFW):**
```
Flags: CREATOR_MERCH, COSPLAY, GAMING, COLLECTIBLES
Cascade: PaymentCloud → Signature → CCBill
Crypto: User opt-in
```

**HIGH RISK (Unmentionables NSFW):**
```
Flags: ADULT_CONTENT, NSFW, 18_PLUS, EXPLICIT
Cascade: Signature → CCBill
Crypto: User opt-in
```

---

## Business Rules

### Card Network Support

| Network | Stripe | PaymentCloud | Signature | CCBill |
|---------|--------|--------------|-----------|--------|
| Visa | ✅ | ✅ | ✅ | ✅ |
| Mastercard | ✅ | ✅ | ✅ | ✅ |
| Visa Debit | ✅ | ✅ | ✅ | ✅ |
| MC Debit | ✅ | ✅ | ✅ | ✅ |
| Amex | ❌ | ❌ | ❌ | ❌ |

**Note:** American Express excluded due to adult content restrictions across all processors.

### Payment Windows

| Method | Window | Countdown Warnings |
|--------|--------|-------------------|
| Card | 20 minutes | 5 min, 2 min, 1 min |
| Crypto | 72 hours | 24h, 12h, 1h |

### Cascade Behavior

1. Each processor gets **2 attempts** before cascading
2. Wait **3 seconds** between retries at same processor
3. Wait **5 seconds** between processor switches
4. Log **every** attempt with correlation ID
5. CCBill is **ALWAYS** the final card fallback
6. After all cards fail → Show crypto option (don't auto-redirect)

### Non-Payment Penalties

| Offense | Within | Penalty |
|---------|--------|---------|
| 1st | Any time | 7-day bidding suspension |
| 2nd | 90 days of 1st | 30-day suspension |
| 3rd | 180 days of 2nd | Permanent ban |

### Escrow Rules

- Platform holds funds for **72 hours** after successful payment
- Buyer has dispute window during hold period
- Auto-release to seller after 3 days if no dispute
- Manual early release available for verified sellers (Tier 2+)

### Fee Structure

| Processor | Base Rate | Per Transaction | Notes |
|-----------|-----------|-----------------|-------|
| Stripe | 2.9% | $0.30 | Standard pricing |
| PaymentCloud | 3.5% | $0.30 | High-risk pricing |
| Signature | 4-6% | $0.30 | Negotiated rate |
| CCBill | 8-10% | $0.00 | All-inclusive |
| NOWPayments | ~1% | Network fee | Crypto only |

---

## Features to Build

### 1. Payment Orchestrator (Core)

The central coordinator that:
- Analyzes listing content flags
- Determines appropriate cascade order
- Manages correlation IDs across attempts
- Coordinates processor health checks
- Handles timeout and retry logic

### 2. Modular Processor Interface

Each processor implements:

```typescript
interface PaymentProcessor {
  readonly name: ProcessorName;
  readonly supportedCards: CardNetwork[];
  readonly supportedContentFlags: ContentFlag[];
  
  initialize(): Promise<void>;
  
  processPayment(
    transaction: Transaction,
    paymentMethod: PaymentMethod
  ): Promise<PaymentResult>;
  
  refundPayment(
    originalPaymentId: string,
    amount?: number
  ): Promise<RefundResult>;
  
  healthCheck(): Promise<ProcessorHealth>;
  
  validatePaymentMethod(
    paymentMethod: PaymentMethod
  ): Promise<ValidationResult>;
}

interface PaymentResult {
  success: boolean;
  processorPaymentId?: string;
  errorCode?: ErrorCode;
  errorMessage?: string;
  retryable: boolean;
  responseTimeMs: number;
  rawResponse?: unknown;
}

interface ProcessorHealth {
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  latencyMs: number;
  successRate24h: number;
  lastError?: string;
  checkedAt: Date;
}
```

### 3. Payment Checkout Flow

**Card Payment Flow:**
1. Auction ends → Winner determined
2. Create `payment_transaction` record (status: PENDING)
3. Start 20-minute countdown
4. Display checkout page with payment form
5. User enters card details
6. Orchestrator determines cascade order from content flags
7. Attempt payment through cascade
8. On success: Update status, show confirmation, schedule escrow release
9. On failure: Show error, allow retry or crypto option

**Crypto Payment Flow:**
1. User clicks "Pay with Crypto" button
2. Create NOWPayments invoice
3. Display QR code and wallet address
4. Start 72-hour countdown
5. Poll for payment confirmation (IPN webhook)
6. On detection: Wait for confirmations
7. On confirmation: Update status, schedule escrow release

### 4. Payment Countdown Timer

**Requirements:**
- Server-synced countdown (prevents client manipulation)
- Visual warnings at thresholds (5min, 2min, 1min for cards)
- Auto-fail transaction on expiry
- Accessible announcements for screen readers (ARIA live regions)

### 5. Real-Time Status Updates

- Supabase Realtime subscription to `payment_transactions`
- Update UI as payment processes
- Show cascade progress (which processor currently trying)
- Display error messages with retry options

### 6. Admin Payment Dashboard

**Route:** `/admin/payment-config`

**Panels:**

1. **Processor Configuration**
   - Enable/disable toggles per processor
   - Retry limit configuration
   - Timeout settings
   - API key management (masked display)

2. **Cascade Rule Editor**
   - Visual cascade builder per content flag group
   - Drag-and-drop reordering
   - Test cascade logic with sample transactions

3. **Content Flag Manager**
   - Create/edit/delete content flags
   - Assign risk levels
   - Attach marketing guidelines
   - Map flags to processor cascades

4. **Health Dashboard**
   - Real-time success rates per processor
   - Average response times (sparklines)
   - Decline reason breakdown (pie chart)
   - Alert configuration for degradation

5. **Transaction Log Viewer**
   - Search by transaction ID, correlation ID, user ID
   - Filter by processor, status, date range
   - View full cascade attempt history
   - Export logs as CSV

---

## Database Schema

### New Enums

```sql
CREATE TYPE payment_processor AS ENUM (
  'STRIPE',
  'PAYMENTCLOUD',
  'SIGNATURE',
  'CCBILL',
  'NOWPAYMENTS'
);

CREATE TYPE payment_status AS ENUM (
  'PENDING',
  'PROCESSING',
  'AWAITING_CRYPTO',
  'COMPLETED',
  'FAILED',
  'EXPIRED',
  'REFUNDED',
  'DISPUTED'
);

CREATE TYPE payment_method_type AS ENUM (
  'CARD',
  'CRYPTO'
);

CREATE TYPE content_risk_level AS ENUM (
  'LOW',
  'MEDIUM',
  'HIGH'
);

CREATE TYPE escrow_status AS ENUM (
  'HELD',
  'RELEASED',
  'DISPUTED',
  'REFUNDED'
);
```

### Core Tables

```sql
CREATE TABLE payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID REFERENCES auctions(id) NOT NULL,
  buyer_id UUID REFERENCES users(id) NOT NULL,
  seller_id UUID REFERENCES users(id) NOT NULL,
  
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  platform_fee_cents INTEGER NOT NULL CHECK (platform_fee_cents >= 0),
  seller_payout_cents INTEGER NOT NULL CHECK (seller_payout_cents > 0),
  currency currency_code NOT NULL DEFAULT 'CAD',
  
  payment_method payment_method_type NOT NULL DEFAULT 'CARD',
  
  current_processor payment_processor,
  processor_payment_id TEXT,
  processor_customer_id TEXT,
  processor_fee_cents INTEGER,
  
  crypto_payment_id TEXT,
  crypto_currency TEXT,
  crypto_amount TEXT,
  crypto_address TEXT,
  
  status payment_status NOT NULL DEFAULT 'PENDING',
  failure_reason TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  
  content_flags TEXT[] NOT NULL DEFAULT '{}',
  content_risk_level content_risk_level NOT NULL DEFAULT 'LOW',
  cascade_correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  
  payment_deadline TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  
  escrow_status escrow_status DEFAULT 'HELD',
  escrow_release_at TIMESTAMPTZ,
  escrow_released_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_transactions_auction ON payment_transactions(auction_id);
CREATE INDEX idx_payment_transactions_buyer ON payment_transactions(buyer_id);
CREATE INDEX idx_payment_transactions_seller ON payment_transactions(seller_id);
CREATE INDEX idx_payment_transactions_status ON payment_transactions(status);
CREATE INDEX idx_payment_transactions_correlation ON payment_transactions(cascade_correlation_id);
CREATE INDEX idx_payment_transactions_deadline ON payment_transactions(payment_deadline) 
  WHERE status = 'PENDING';
```

### Payment Attempt Logging

```sql
CREATE TABLE payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES payment_transactions(id) NOT NULL,
  correlation_id UUID NOT NULL,
  
  processor payment_processor NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  cascade_position INTEGER NOT NULL,
  
  success BOOLEAN NOT NULL,
  error_code TEXT,
  error_message TEXT,
  retryable BOOLEAN NOT NULL DEFAULT FALSE,
  
  response_time_ms INTEGER NOT NULL,
  raw_response JSONB,
  
  card_last_four TEXT,
  card_brand TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_attempts_transaction ON payment_attempts(transaction_id);
CREATE INDEX idx_payment_attempts_correlation ON payment_attempts(correlation_id);
CREATE INDEX idx_payment_attempts_processor ON payment_attempts(processor);
CREATE INDEX idx_payment_attempts_created ON payment_attempts(created_at);
```

### Admin Configuration Tables

```sql
CREATE TABLE processor_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  processor payment_processor UNIQUE NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  max_retry_attempts INTEGER NOT NULL DEFAULT 2,
  timeout_ms INTEGER NOT NULL DEFAULT 30000,
  priority INTEGER NOT NULL DEFAULT 0,
  
  api_key_encrypted TEXT,
  api_secret_encrypted TEXT,
  merchant_id TEXT,
  additional_config JSONB DEFAULT '{}',
  
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE cascade_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  content_flags TEXT[] NOT NULL,
  risk_level content_risk_level NOT NULL,
  cascade_order payment_processor[] NOT NULL,
  max_total_attempts INTEGER NOT NULL DEFAULT 6,
  crypto_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cascade_rules_flags ON cascade_rules USING GIN (content_flags);
CREATE INDEX idx_cascade_rules_active ON cascade_rules(is_active) WHERE is_active = TRUE;

CREATE TABLE content_flags_definition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  risk_level content_risk_level NOT NULL,
  brand brand_type NOT NULL,
  marketing_guidelines TEXT,
  prohibited_terms TEXT[],
  recommended_terms TEXT[],
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Processor Health Tracking

```sql
CREATE TABLE processor_health_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  processor payment_processor NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  success_rate_1h DECIMAL(5,4),
  success_rate_24h DECIMAL(5,4),
  error_message TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_processor_health_processor ON processor_health_log(processor, checked_at DESC);

CREATE TABLE processor_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  processor payment_processor NOT NULL,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_by UUID REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Schema Modifications

```sql
ALTER TABLE listings ADD COLUMN IF NOT EXISTS content_flags TEXT[] DEFAULT '{}';

ALTER TABLE users ADD COLUMN IF NOT EXISTS bidding_suspended_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bidding_banned BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS non_payment_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_non_payment_at TIMESTAMPTZ;
```

### RLS Policies

```sql
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_transactions_buyer_read ON payment_transactions
  FOR SELECT USING (buyer_id = auth.uid());

CREATE POLICY payment_transactions_seller_read ON payment_transactions
  FOR SELECT USING (seller_id = auth.uid());

CREATE POLICY payment_transactions_buyer_update ON payment_transactions
  FOR UPDATE USING (buyer_id = auth.uid() AND status = 'PENDING');

CREATE POLICY payment_attempts_owner_read ON payment_attempts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM payment_transactions pt 
      WHERE pt.id = payment_attempts.transaction_id 
      AND (pt.buyer_id = auth.uid() OR pt.seller_id = auth.uid())
    )
  );

ALTER TABLE processor_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE cascade_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_flags_definition ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_only_processor_config ON processor_config
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role = 'ADMIN'
    )
  );

CREATE POLICY admin_only_cascade_rules ON cascade_rules
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role = 'ADMIN'
    )
  );

CREATE POLICY public_read_content_flags ON content_flags_definition
  FOR SELECT USING (is_active = TRUE);

CREATE POLICY admin_write_content_flags ON content_flags_definition
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role = 'ADMIN'
    )
  );
```

### Database Functions

```sql
CREATE OR REPLACE FUNCTION calculate_platform_fee(amount_cents INTEGER)
RETURNS INTEGER AS $$
BEGIN
  RETURN GREATEST(FLOOR(amount_cents * 0.10), 100);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION get_cascade_for_flags(flags TEXT[])
RETURNS payment_processor[] AS $$
DECLARE
  result payment_processor[];
  rule RECORD;
BEGIN
  SELECT cr.cascade_order INTO result
  FROM cascade_rules cr
  WHERE cr.is_active = TRUE
    AND cr.content_flags && flags
  ORDER BY cr.risk_level DESC
  LIMIT 1;
  
  IF result IS NULL THEN
    result := ARRAY['STRIPE', 'PAYMENTCLOUD', 'SIGNATURE', 'CCBILL']::payment_processor[];
  END IF;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION expire_pending_payments()
RETURNS INTEGER AS $$
DECLARE
  expired_count INTEGER;
BEGIN
  WITH expired AS (
    UPDATE payment_transactions
    SET 
      status = 'EXPIRED',
      updated_at = NOW()
    WHERE status = 'PENDING'
      AND payment_deadline < NOW()
    RETURNING buyer_id
  )
  SELECT COUNT(*) INTO expired_count FROM expired;
  
  RETURN expired_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION apply_non_payment_penalty(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
  v_count INTEGER;
  v_last_offense TIMESTAMPTZ;
BEGIN
  SELECT non_payment_count, last_non_payment_at
  INTO v_count, v_last_offense
  FROM users WHERE id = p_user_id;
  
  v_count := COALESCE(v_count, 0) + 1;
  
  IF v_count >= 3 AND v_last_offense > NOW() - INTERVAL '180 days' THEN
    UPDATE users SET
      bidding_banned = TRUE,
      non_payment_count = v_count,
      last_non_payment_at = NOW()
    WHERE id = p_user_id;
  ELSIF v_count >= 2 AND v_last_offense > NOW() - INTERVAL '90 days' THEN
    UPDATE users SET
      bidding_suspended_until = NOW() + INTERVAL '30 days',
      non_payment_count = v_count,
      last_non_payment_at = NOW()
    WHERE id = p_user_id;
  ELSE
    UPDATE users SET
      bidding_suspended_until = NOW() + INTERVAL '7 days',
      non_payment_count = v_count,
      last_non_payment_at = NOW()
    WHERE id = p_user_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION release_escrow_funds()
RETURNS INTEGER AS $$
DECLARE
  released_count INTEGER;
BEGIN
  WITH released AS (
    UPDATE payment_transactions
    SET 
      escrow_status = 'RELEASED',
      escrow_released_at = NOW(),
      updated_at = NOW()
    WHERE status = 'COMPLETED'
      AND escrow_status = 'HELD'
      AND escrow_release_at <= NOW()
    RETURNING id
  )
  SELECT COUNT(*) INTO released_count FROM released;
  
  RETURN released_count;
END;
$$ LANGUAGE plpgsql;
```

### Scheduled Jobs (pg_cron)

```sql
SELECT cron.schedule(
  'expire-pending-payments',
  '* * * * *',
  'SELECT expire_pending_payments()'
);

SELECT cron.schedule(
  'release-escrow-funds',
  '*/5 * * * *',
  'SELECT release_escrow_funds()'
);

SELECT cron.schedule(
  'processor-health-check',
  '*/1 * * * *',
  'SELECT check_all_processor_health()'
);
```

---

## Technical Architecture

### File Structure

```
backend/
├── src/
│   ├── controllers/
│   │   ├── paymentController.ts
│   │   └── adminPaymentController.ts
│   ├── services/
│   │   ├── paymentOrchestrator.ts
│   │   ├── escrowService.ts
│   │   └── penaltyService.ts
│   ├── processors/
│   │   ├── index.ts
│   │   ├── baseProcessor.ts
│   │   ├── stripeProcessor.ts
│   │   ├── paymentCloudProcessor.ts
│   │   ├── signatureProcessor.ts
│   │   ├── ccbillProcessor.ts
│   │   └── nowPaymentsProcessor.ts
│   ├── routes/
│   │   ├── payments.ts
│   │   └── adminPayments.ts
│   ├── webhooks/
│   │   ├── stripeWebhook.ts
│   │   ├── paymentCloudWebhook.ts
│   │   ├── ccbillWebhook.ts
│   │   └── nowPaymentsWebhook.ts
│   └── lib/
│       ├── contentFlags.ts
│       ├── cascadeRouter.ts
│       └── paymentLogger.ts

frontend/
├── src/
│   ├── pages/
│   │   ├── PaymentCheckout.tsx
│   │   └── admin/
│   │       └── PaymentConfig.tsx
│   └── features/
│       └── payments/
│           ├── components/
│           │   ├── PaymentForm.tsx
│           │   ├── PaymentCountdown.tsx
│           │   ├── CryptoPayment.tsx
│           │   ├── PaymentStatus.tsx
│           │   ├── CascadeProgress.tsx
│           │   └── admin/
│           │       ├── ProcessorToggle.tsx
│           │       ├── CascadeEditor.tsx
│           │       ├── HealthDashboard.tsx
│           │       └── AttemptLogViewer.tsx
│           ├── hooks/
│           │   ├── usePayment.ts
│           │   ├── usePaymentStatus.ts
│           │   ├── useCountdown.ts
│           │   └── useProcessorHealth.ts
│           └── stores/
│               └── paymentStore.ts
```

### API Endpoints

```
POST   /api/v1/payments/checkout/:auctionId     Initialize payment
POST   /api/v1/payments/:transactionId/process  Process card payment
POST   /api/v1/payments/:transactionId/crypto   Create crypto invoice
GET    /api/v1/payments/:transactionId          Get payment status
POST   /api/v1/payments/:transactionId/retry    Retry failed payment

POST   /api/v1/webhooks/stripe                  Stripe webhook
POST   /api/v1/webhooks/paymentcloud            PaymentCloud IPN
POST   /api/v1/webhooks/ccbill                  CCBill webhook
POST   /api/v1/webhooks/nowpayments             NOWPayments IPN

GET    /api/v1/admin/payments/config            Get all processor configs
PUT    /api/v1/admin/payments/config/:processor Update processor config
GET    /api/v1/admin/payments/cascades          Get cascade rules
PUT    /api/v1/admin/payments/cascades/:id      Update cascade rule
GET    /api/v1/admin/payments/health            Get processor health
GET    /api/v1/admin/payments/logs              Query payment logs
GET    /api/v1/admin/payments/flags             Get content flags
PUT    /api/v1/admin/payments/flags/:id         Update content flag
```

---

## Implementation Guide

### Phase 1: Database & Core Types (Day 1)

1. Create all new enums and tables
2. Add RLS policies
3. Create database functions
4. Set up pg_cron jobs
5. Generate TypeScript types

### Phase 2: Base Processor Interface (Day 1-2)

1. Define PaymentProcessor interface
2. Create BaseProcessor abstract class
3. Implement structured logging
4. Build health check framework
5. Create processor factory

### Phase 3: Stripe Integration (Day 2)

1. Implement StripeProcessor
2. Payment intent creation
3. Webhook handler
4. Refund implementation
5. Testing with Stripe CLI

### Phase 4: PaymentCloud Integration (Day 3)

1. Implement PaymentCloudProcessor (NMI gateway)
2. Three Step Redirect flow
3. IPN webhook handler
4. Security key management
5. Testing with sandbox

### Phase 5: Signature Integration (Day 4)

1. Implement SignatureProcessor (NMI/Innovio)
2. API authentication
3. Payment processing flow
4. Webhook handling
5. Testing

### Phase 6: CCBill Integration (Day 5)

1. Implement CCBillProcessor
2. FlexForms integration
3. Dynamic pricing setup
4. Webhook configuration
5. OAuth token management
6. Testing with sandbox

### Phase 7: NOWPayments Integration (Day 6)

1. Implement NOWPaymentsProcessor
2. Invoice creation
3. IPN webhook for payment detection
4. Confirmation tracking
5. Testing with sandbox

### Phase 8: Payment Orchestrator (Day 6-7)

1. Content flag analysis
2. Cascade routing logic
3. Correlation ID management
4. Retry and backoff logic
5. Error categorization

### Phase 9: Frontend Checkout (Day 7-8)

1. Payment checkout page
2. Card payment form (Stripe Elements base)
3. Payment countdown timer
4. Crypto payment option
5. Real-time status updates
6. Error handling UI

### Phase 10: Admin Dashboard (Day 8-9)

1. Processor configuration panel
2. Cascade rule editor
3. Content flag manager
4. Health monitoring dashboard
5. Transaction log viewer

### Phase 11: Testing & Polish (Day 9-10)

1. Integration tests per processor
2. E2E checkout flow tests
3. Cascade failure scenarios
4. Load testing
5. Accessibility audit
6. Documentation

---

## Error Handling

### Error Categories

```typescript
enum PaymentErrorCategory {
  CARD_ERROR = 'CARD_ERROR',
  PROCESSOR_ERROR = 'PROCESSOR_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  SYSTEM_ERROR = 'SYSTEM_ERROR'
}

const RETRYABLE_ERRORS = [
  'PROCESSOR_TIMEOUT',
  'PROCESSOR_TEMPORARILY_DOWN',
  'RATE_LIMIT_EXCEEDED',
  'NETWORK_TIMEOUT',
  'CARD_DECLINED_SOFT'
];

const NON_RETRYABLE_ERRORS = [
  'INSUFFICIENT_FUNDS',
  'CARD_STOLEN',
  'CARD_EXPIRED',
  'INVALID_CARD_NUMBER',
  'CARD_DECLINED_HARD',
  'FRAUD_DETECTED',
  'DO_NOT_HONOR'
];

const ADMIN_ALERT_ERRORS = [
  'API_AUTHENTICATION_FAILED',
  'PROCESSOR_DOWN',
  'DATABASE_ERROR',
  'WEBHOOK_VERIFICATION_FAILED',
  'INVALID_TRANSACTION_STATE'
];
```

### Structured Logging

```typescript
interface PaymentAttemptLog {
  transactionId: string;
  correlationId: string;
  processor: PaymentProcessor;
  attemptNumber: number;
  cascadePosition: number;
  success: boolean;
  errorCode?: string;
  errorCategory?: PaymentErrorCategory;
  errorMessage?: string;
  retryable: boolean;
  responseTimeMs: number;
  cardLastFour?: string;
  cardBrand?: string;
  rawResponse?: unknown;
  timestamp: Date;
}
```

---

## Success Criteria

### Functionality

- [ ] Auction winners can complete card payment
- [ ] Payment routes through correct processor cascade based on content flags
- [ ] Failed payments cascade to next processor automatically
- [ ] CCBill serves as universal final fallback
- [ ] Users can opt-in to crypto payment
- [ ] Crypto payments have 72-hour window
- [ ] Payment countdown timer accurate and synced
- [ ] Escrow holds funds for 72 hours
- [ ] Auto-release after escrow period
- [ ] Non-payment penalties applied correctly
- [ ] All payment attempts logged with correlation IDs
- [ ] Admin can configure processors
- [ ] Admin can edit cascade rules
- [ ] Admin can view health dashboard
- [ ] Admin can search transaction logs

### WCAG Compliance

- [ ] All interactive elements ≥44px
- [ ] Skip link present
- [ ] Proper heading hierarchy
- [ ] ARIA live regions for countdown and status
- [ ] Form error messages accessible
- [ ] Keyboard navigation complete
- [ ] Color contrast AA compliant
- [ ] Focus indicators visible

### Security

- [ ] Card data never stored on our servers
- [ ] API keys encrypted in database
- [ ] Webhook signatures verified
- [ ] CSRF protection on payment forms
- [ ] Rate limiting on payment endpoints
- [ ] Audit logging for admin actions

### Performance

- [ ] Payment attempt response <5s
- [ ] Checkout page load <2s
- [ ] Real-time updates <500ms latency
- [ ] Database queries <50ms

---

## Testing Checklist

### Manual Testing

1. **Happy Path - Card Payment (Low Risk)**
   - Create listing with MEMORABILIA flag
   - Complete auction
   - Checkout as winner
   - Verify Stripe processes payment
   - Check escrow status

2. **Cascade Testing**
   - Configure Stripe to fail
   - Verify PaymentCloud receives payment
   - Configure both to fail
   - Verify CCBill receives payment

3. **Crypto Payment**
   - Create listing
   - Complete auction
   - Select "Pay with Crypto"
   - Verify invoice created
   - Simulate payment via sandbox
   - Verify confirmation flow

4. **Non-Payment Flow**
   - Let payment deadline expire
   - Verify transaction marked EXPIRED
   - Verify penalty applied
   - Verify bidding suspension

5. **Admin Panel**
   - Toggle processor enabled/disabled
   - Modify cascade rules
   - View health dashboard
   - Search transaction logs

### Integration Tests

```bash
npm run test:integration -- payments.test.ts
npm run test:integration -- cascade.test.ts
npm run test:integration -- admin-payments.test.ts
```

### E2E Tests

```bash
npm run test:e2e -- payment-checkout.spec.ts
npm run test:e2e -- payment-admin.spec.ts
```

---

## Environment Variables

```bash
# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PUBLISHABLE_KEY=pk_test_...

# PaymentCloud (NMI)
PAYMENTCLOUD_SECURITY_KEY=...
PAYMENTCLOUD_MERCHANT_ID=...
PAYMENTCLOUD_WEBHOOK_SECRET=...

# Signature Payments (NMI/Innovio)
SIGNATURE_API_KEY=...
SIGNATURE_API_SECRET=...
SIGNATURE_MERCHANT_ID=...

# CCBill
CCBILL_ACCOUNT_NUMBER=...
CCBILL_SUB_ACCOUNT=...
CCBILL_FLEX_ID=...
CCBILL_SALT=...
CCBILL_API_USERNAME=...
CCBILL_API_PASSWORD=...
CCBILL_WEBHOOK_SECRET=...

# NOWPayments
NOWPAYMENTS_API_KEY=...
NOWPAYMENTS_IPN_SECRET=...
NOWPAYMENTS_PAYOUT_WALLET=...

# General
PAYMENT_CARD_TIMEOUT_MINUTES=20
PAYMENT_CRYPTO_TIMEOUT_HOURS=72
ESCROW_HOLD_HOURS=72
PLATFORM_FEE_PERCENT=10
```

---

## Module Completion Checklist

- [ ] All database tables created
- [ ] RLS policies in place
- [ ] Database functions working
- [ ] pg_cron jobs scheduled
- [ ] Stripe processor complete
- [ ] PaymentCloud processor complete
- [ ] Signature processor complete
- [ ] CCBill processor complete
- [ ] NOWPayments processor complete
- [ ] Payment orchestrator working
- [ ] Cascade routing tested
- [ ] Frontend checkout complete
- [ ] Countdown timer accurate
- [ ] Crypto payment flow complete
- [ ] Admin dashboard functional
- [ ] Webhooks handling all events
- [ ] Error handling comprehensive
- [ ] Logging complete
- [ ] Integration tests passing
- [ ] E2E tests passing
- [ ] Accessibility audit passed
- [ ] Security review completed
- [ ] MODULE_09_COMPLETION.md created
- [ ] SCHEMA_LOCK.md updated
- [ ] MASTER_PROMPT updated to v2.1

---

**Timeline:** 7-10 days  
**Priority:** CRITICAL - Core marketplace revenue flow  
**Complexity:** VERY HIGH - Multi-processor integration with cascade logic

**END OF MODULE 09 PROMPT**
