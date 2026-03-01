# Module 09: Payment Cascade Orchestrator

**Parent Module:** 09 - Auction Settlement  
**Component:** Core Orchestration Logic  
**Purpose:** Route payments through appropriate processor cascade based on content flags

---

## Overview

The Payment Orchestrator is the central coordinator that:
1. Analyzes listing content flags to determine risk level
2. Selects appropriate processor cascade
3. Manages retry logic and processor switching
4. Tracks all attempts with correlation IDs
5. Monitors processor health
6. Handles final failure scenarios

---

## Content Flag Risk Levels

### LOW RISK → AuctionX Brand
```typescript
const LOW_RISK_FLAGS = [
  'CONCERT_GEAR', 'MEMORABILIA', 'AUTOGRAPHED',
  'SPORTS_EQUIPMENT', 'VINTAGE_COLLECTIBLES', 'FAN_MERCHANDISE'
];
// Cascade: Stripe → PaymentCloud → Signature → CCBill
```

### MEDIUM RISK → Unmentionables SFW
```typescript
const MEDIUM_RISK_FLAGS = [
  'CREATOR_MERCH', 'COSPLAY', 'GAMING',
  'COLLECTIBLES', 'DIGITAL_GOODS', 'SUBSCRIPTION_BOX'
];
// Cascade: PaymentCloud → Signature → CCBill
```

### HIGH RISK → Unmentionables NSFW
```typescript
const HIGH_RISK_FLAGS = [
  'ADULT_CONTENT', 'NSFW', '18_PLUS', 'EXPLICIT', 'INTIMATE_ITEMS'
];
// Cascade: Signature → CCBill
```

---

## Cascade Configuration

```typescript
const CASCADES: Record<ContentRiskLevel, CascadeConfig> = {
  LOW: {
    processors: ['STRIPE', 'PAYMENTCLOUD', 'SIGNATURE', 'CCBILL'],
    maxAttemptsPerProcessor: 2,
    retryDelayMs: 3000,
    cascadeDelayMs: 5000
  },
  MEDIUM: {
    processors: ['PAYMENTCLOUD', 'SIGNATURE', 'CCBILL'],
    maxAttemptsPerProcessor: 2,
    retryDelayMs: 3000,
    cascadeDelayMs: 5000
  },
  HIGH: {
    processors: ['SIGNATURE', 'CCBILL'],
    maxAttemptsPerProcessor: 2,
    retryDelayMs: 3000,
    cascadeDelayMs: 5000
  }
};
```

---

## Cascade Decision Tree

```
┌─────────────────────────────────────────────────────────────┐
│                    INCOMING PAYMENT                          │
│                   Content Flags: [...]                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │   Determine Risk Level        │
              │   from Content Flags          │
              └───────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
   ┌─────────┐          ┌─────────┐          ┌─────────┐
   │  LOW    │          │ MEDIUM  │          │  HIGH   │
   └─────────┘          └─────────┘          └─────────┘
        │                     │                     │
        ▼                     ▼                     ▼
   STRIPE ──fail──▶    PAYMENTCLOUD ──fail──▶   SIGNATURE
        │                     │                     │
        ▼                     ▼                     ▼
   PAYMENTCLOUD          SIGNATURE               CCBILL
        │                     │                  (final)
        ▼                     ▼
   SIGNATURE               CCBILL
        │                  (final)
        ▼
   CCBILL (final)
```

---

## Retry Logic

### Within Same Processor
- **Max Attempts:** 2
- **Delay Between:** 3 seconds
- **Retry On:** Timeout, rate limit, soft decline

### Between Processors
- **Delay:** 5 seconds
- **Skip If:** Processor DOWN or disabled

### Non-Retryable Errors (Stop Inner Loop)
- Insufficient funds
- Card stolen/lost
- Card expired
- Invalid card number
- Fraud detected

---

## Correlation ID Tracking

Every payment attempt is tagged with a correlation ID:

```
correlationId: "abc-123-def-456"
│
├── Attempt 1: STRIPE, success=false, error=TIMEOUT
├── Attempt 2: STRIPE, success=false, error=DECLINED
├── Attempt 3: PAYMENTCLOUD, success=false, error=DECLINED
├── Attempt 4: SIGNATURE, success=false, error=DECLINED
└── Attempt 5: CCBILL, success=true, paymentId="ccbill-xyz"
```

Query:
```sql
SELECT * FROM payment_attempts
WHERE correlation_id = 'abc-123-def-456'
ORDER BY created_at;
```

---

## Health Monitoring

Check every 60 seconds:
- Latency thresholds: <2s healthy, 2-5s degraded, >5s down
- Success rate: >95% healthy, 80-95% degraded, <80% alert
- Alert admin on DOWN or repeated DEGRADED status

---

**END OF CASCADE ORCHESTRATOR SPEC**
